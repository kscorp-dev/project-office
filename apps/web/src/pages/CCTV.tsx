import { useEffect, useState } from 'react';
import { Camera, MonitorPlay, FolderOpen, RefreshCw, Grid3X3, X } from 'lucide-react';
import api from '../services/api';
import HlsPlayer from '../components/HlsPlayer';

interface CameraGroup {
  id: string;
  name: string;
  cameras: CameraItem[];
}

interface CameraItem {
  id: string;
  name: string;
  rtspUrl: string;
  location?: string;
  isPtz: boolean;
  status: string;
  groupId?: string;
  group?: { id: string; name: string };
}

export default function CCTVPage() {
  const [groups, setGroups] = useState<CameraGroup[]>([]);
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraItem | null>(null);
  const [layout, setLayout] = useState<4 | 9 | 16>(4);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [groupsRes, camerasRes] = await Promise.all([
        api.get('/cctv/groups'),
        api.get('/cctv/cameras'),
      ]);
      setGroups(groupsRes.data.data);
      setCameras(camerasRes.data.data);
    } catch (err) {
      console.error('CCTV data fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const gridCols = layout === 4 ? 'grid-cols-2' : layout === 9 ? 'grid-cols-3' : 'grid-cols-4';

  if (loading) {
    return <div className="flex items-center justify-center h-full"><RefreshCw className="animate-spin text-gray-400" size={32} /></div>;
  }

  return (
    <div className="flex h-full">
      {/* Sidebar - Camera List */}
      <div className="w-64 bg-white border-r overflow-y-auto">
        <div className="p-4 border-b">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <Camera size={20} /> CCTV
          </h2>
        </div>
        <div className="p-2">
          {groups.map((group) => (
            <div key={group.id} className="mb-2">
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600">
                <FolderOpen size={14} />
                {group.name}
              </div>
              {group.cameras.map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setSelectedCamera(cam)}
                  className={`w-full text-left px-3 py-2 pl-8 text-sm rounded-xl hover:bg-primary-50/50 ${
                    selectedCamera?.id === cam.id ? 'bg-primary-50 text-primary-700' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cam.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    {cam.name}
                  </div>
                  {cam.location && <p className="text-xs text-gray-400 mt-0.5">{cam.location}</p>}
                </button>
              ))}
            </div>
          ))}
          {/* Ungrouped cameras */}
          {cameras.filter(c => !c.groupId).length > 0 && (
            <div className="mb-2">
              <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-600">
                <FolderOpen size={14} />
                미분류
              </div>
              {cameras.filter(c => !c.groupId).map((cam) => (
                <button
                  key={cam.id}
                  onClick={() => setSelectedCamera(cam)}
                  className={`w-full text-left px-3 py-2 pl-8 text-sm rounded-xl hover:bg-primary-50/50 ${
                    selectedCamera?.id === cam.id ? 'bg-primary-50 text-primary-700' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cam.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    {cam.name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main View */}
      <div className="flex-1 bg-gray-900 p-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-medium">
            {selectedCamera ? selectedCamera.name : '실시간 모니터링'}
          </h3>
          <div className="flex items-center gap-2">
            {[4, 9, 16].map((n) => (
              <button
                key={n}
                onClick={() => setLayout(n as 4 | 9 | 16)}
                className={`p-2 rounded-xl text-sm ${layout === n ? 'bg-primary-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                <Grid3X3 size={16} />
                <span className="ml-1 text-xs">{n}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Camera Grid */}
        {selectedCamera ? (
          <div className="h-[calc(100%-48px)] relative">
            <HlsPlayer
              cameraId={selectedCamera.id}
              cameraName={`${selectedCamera.name}${selectedCamera.location ? ` · ${selectedCamera.location}` : ''}`}
              overlay={
                <button
                  onClick={() => setSelectedCamera(null)}
                  className="bg-black/50 text-white hover:bg-black/70 rounded-full p-1.5"
                  title="닫기"
                >
                  <X size={16} />
                </button>
              }
            />
          </div>
        ) : (
          <div className={`grid ${gridCols} gap-2 h-[calc(100%-48px)]`}>
            {cameras.slice(0, layout).map((cam) => (
              <div
                key={cam.id}
                onClick={() => setSelectedCamera(cam)}
                className="relative cursor-pointer rounded-2xl overflow-hidden hover:ring-2 hover:ring-primary-500 bg-gray-800"
                title={`${cam.name} 클릭하여 재생`}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <MonitorPlay size={32} className="text-gray-600" />
                  <p className="text-gray-400 text-xs mt-2">{cam.name}</p>
                  {cam.location && <p className="text-gray-500 text-[10px]">{cam.location}</p>}
                  <p className="text-gray-600 text-[10px] mt-1">클릭하여 재생</p>
                </div>
                <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${cam.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>
            ))}
            {Array.from({ length: Math.max(0, layout - cameras.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="bg-gray-800 rounded-2xl flex items-center justify-center">
                <p className="text-gray-600 text-sm">빈 채널</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
