import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Car, Search, Camera, MapPin,
  X, Image, AlertCircle, Check, RefreshCw,
  ArrowRightLeft, Send, Cpu, Upload, Zap, Eye,
  Radio, Wifi, Settings2, Play, Square, Video,
  Plus, Trash2, LogIn, LogOut, Activity, Shield,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';

/* ── 타입 ── */
type Zone = string;
type VehicleStatus = 'parked' | 'departed';

interface ZoneData {
  id: string; name: string; label: string;
  x1: number; y1: number; x2: number; y2: number;
  totalSpots: number; cameraId?: string;
  lines?: LineData[];
}

interface LineData {
  id: string; name: string; type: 'entry' | 'exit' | 'both';
  x1: number; y1: number; x2: number; y2: number;
  zoneId?: string;
}

interface VehiclePhoto {
  direction: '전면' | '후면' | '좌측' | '우측';
  url: string;
  timestamp: string;
}

interface ParkingRecord {
  id: string;
  plateNumber: string;
  zone: Zone;
  spot: string;            // e.g. "A-12"
  status: VehicleStatus;
  entryTime: string;
  exitTime?: string;
  driverName: string;
  driverPhone: string;
  driverCompany: string;
  purpose: string;
  destination?: string;     // 출고 시 도착지
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  entryPhotos: VehiclePhoto[];
  exitPhotos: VehiclePhoto[];
  notificationSent: boolean;
}

/* ── 데모 데이터 ── */
const DEMO_RECORDS: ParkingRecord[] = [
  {
    id: 'p1', plateNumber: '12가 3456', zone: 'A', spot: 'A-05',
    status: 'parked', entryTime: '2026-04-09T08:30:00',
    driverName: '김운전', driverPhone: '010-1234-5678', driverCompany: '(주)KS코퍼레이션',
    purpose: '자재 입고',
    entryPhotos: [
      { direction: '전면', url: '', timestamp: '2026-04-09T08:30:01' },
      { direction: '후면', url: '', timestamp: '2026-04-09T08:30:02' },
      { direction: '좌측', url: '', timestamp: '2026-04-09T08:30:03' },
      { direction: '우측', url: '', timestamp: '2026-04-09T08:30:04' },
    ],
    exitPhotos: [], notificationSent: false,
  },
  {
    id: 'p2', plateNumber: '34나 7890', zone: 'B', spot: 'B-12',
    status: 'parked', entryTime: '2026-04-09T09:15:00',
    driverName: '이배송', driverPhone: '010-9876-5432', driverCompany: '한진물류',
    purpose: '택배 배송',
    entryPhotos: [
      { direction: '전면', url: '', timestamp: '2026-04-09T09:15:01' },
      { direction: '후면', url: '', timestamp: '2026-04-09T09:15:02' },
      { direction: '좌측', url: '', timestamp: '2026-04-09T09:15:03' },
      { direction: '우측', url: '', timestamp: '2026-04-09T09:15:04' },
    ],
    exitPhotos: [], notificationSent: false,
  },
  {
    id: 'p3', plateNumber: '56다 1234', zone: 'C', spot: 'C-03',
    status: 'parked', entryTime: '2026-04-09T07:45:00',
    driverName: '박방문', driverPhone: '010-5555-6666', driverCompany: '삼성전자',
    purpose: '미팅 방문',
    entryPhotos: [
      { direction: '전면', url: '', timestamp: '2026-04-09T07:45:01' },
      { direction: '후면', url: '', timestamp: '2026-04-09T07:45:02' },
      { direction: '좌측', url: '', timestamp: '2026-04-09T07:45:03' },
      { direction: '우측', url: '', timestamp: '2026-04-09T07:45:04' },
    ],
    exitPhotos: [], notificationSent: false,
  },
  {
    id: 'p4', plateNumber: '78라 5678', zone: 'A', spot: 'A-08',
    status: 'departed', entryTime: '2026-04-09T06:00:00', exitTime: '2026-04-09T08:00:00',
    driverName: '정출발', driverPhone: '010-1111-2222', driverCompany: 'CJ대한통운',
    purpose: '자재 출고', destination: '부산 공장',
    recipientName: '홍담당', recipientEmail: 'hong@kscorp.kr', recipientPhone: '010-3333-4444',
    entryPhotos: [
      { direction: '전면', url: '', timestamp: '2026-04-09T06:00:01' },
      { direction: '후면', url: '', timestamp: '2026-04-09T06:00:02' },
      { direction: '좌측', url: '', timestamp: '2026-04-09T06:00:03' },
      { direction: '우측', url: '', timestamp: '2026-04-09T06:00:04' },
    ],
    exitPhotos: [
      { direction: '전면', url: '', timestamp: '2026-04-09T08:00:01' },
      { direction: '후면', url: '', timestamp: '2026-04-09T08:00:02' },
      { direction: '좌측', url: '', timestamp: '2026-04-09T08:00:03' },
      { direction: '우측', url: '', timestamp: '2026-04-09T08:00:04' },
    ],
    notificationSent: true,
  },
];

const ZONE_COLORS = ['bg-blue-500', 'bg-primary-500', 'bg-yellow-500', 'bg-teal-500', 'bg-pink-500', 'bg-indigo-500'];

/* ── 주차장 맵 컴포넌트 (동적 구역) ── */
function ParkingMap({ records, zones }: { records: ParkingRecord[]; zones: ZoneData[] }) {
  const parked = records.filter(r => r.status === 'parked');

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <MapPin size={16} className="text-primary-500" /> 주차장 현황
      </h3>
      {zones.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          관리자가 구역을 설정하면 주차장 현황이 표시됩니다.
        </p>
      ) : (
        <div className={`grid gap-3 ${zones.length === 1 ? 'grid-cols-1' : zones.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {zones.map((zone, idx) => {
            const color = ZONE_COLORS[idx % ZONE_COLORS.length];
            const total = zone.totalSpots || 0;
            const occupied = parked.filter(r => r.zone === zone.label).length;
            const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
            return (
              <div key={zone.id} className="border border-gray-100 rounded-2xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${color}`} />
                  <span className="text-sm font-semibold text-gray-800">{zone.name}</span>
                </div>
                {total > 0 ? (
                  <div className="grid grid-cols-5 gap-1 mb-2">
                    {Array.from({ length: total }, (_, i) => {
                      const spotId = `${zone.label}-${String(i + 1).padStart(2, '0')}`;
                      const car = parked.find(r => r.spot === spotId);
                      return (
                        <div
                          key={spotId}
                          className={`aspect-[3/2] rounded text-[8px] flex items-center justify-center font-mono ${
                            car ? `${color} text-white font-bold cursor-pointer hover:opacity-80` : 'bg-gray-100 text-gray-300'
                          }`}
                          title={car ? `${car.plateNumber} — ${car.driverName}` : `${spotId} (빈자리)`}
                        >
                          {car ? <Car size={10} /> : i + 1}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-300 py-3 text-center">주차면 미설정</p>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 font-medium">{occupied}/{total || '–'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 4면 사진 뷰어 ── */
function PhotoGrid({ photos, label }: { photos: VehiclePhoto[]; label: string }) {
  if (photos.length === 0) return (
    <div className="text-center py-4 text-xs text-gray-400">
      <Camera size={20} className="mx-auto mb-1 opacity-30" />
      {label} 사진 없음
    </div>
  );

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 mb-2">{label} (4면)</p>
      <div className="grid grid-cols-4 gap-2">
        {photos.map(p => (
          <div key={p.direction} className="relative">
            <div className="aspect-[4/3] bg-gray-100 rounded-xl flex items-center justify-center">
              <div className="text-center">
                <Camera size={20} className="mx-auto text-gray-300 mb-1" />
                <p className="text-[10px] text-gray-400">{p.direction}</p>
              </div>
            </div>
            <span className="absolute bottom-1 right-1 text-[8px] bg-black/50 text-white px-1 rounded">
              {new Date(p.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 차량 상세 모달 ── */
function VehicleDetailModal({
  record,
  onClose,
  onDeparture,
}: {
  record: ParkingRecord;
  onClose: () => void;
  onDeparture: (id: string, data: Partial<ParkingRecord>) => void;
}) {
  const [showDepartureForm, setShowDepartureForm] = useState(false);
  const [destination, setDestination] = useState(record.destination || '');
  const [recipientName, setRecipientName] = useState(record.recipientName || '');
  const [recipientEmail, setRecipientEmail] = useState(record.recipientEmail || '');
  const [recipientPhone, setRecipientPhone] = useState(record.recipientPhone || '');
  const [sending, setSending] = useState(false);

  const formatDt = (d: string) => new Date(d).toLocaleString('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const duration = () => {
    const start = new Date(record.entryTime).getTime();
    const end = record.exitTime ? new Date(record.exitTime).getTime() : Date.now();
    const mins = Math.round((end - start) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };

  const handleDeparture = async () => {
    setSending(true);
    await new Promise(r => setTimeout(r, 1000));
    onDeparture(record.id, {
      status: 'departed',
      exitTime: new Date().toISOString(),
      destination,
      recipientName,
      recipientEmail,
      recipientPhone,
      exitPhotos: [
        { direction: '전면', url: '', timestamp: new Date().toISOString() },
        { direction: '후면', url: '', timestamp: new Date().toISOString() },
        { direction: '좌측', url: '', timestamp: new Date().toISOString() },
        { direction: '우측', url: '', timestamp: new Date().toISOString() },
      ],
      notificationSent: true,
    });
    setSending(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white rounded-t-3xl z-10">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm ${
              record.status === 'parked' ? 'bg-primary-500' : 'bg-gray-400'
            }`}>
              <Car size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-lg">{record.plateNumber}</h3>
              <p className="text-xs text-gray-400">{record.zone}구역 {record.spot}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              record.status === 'parked' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {record.status === 'parked' ? '주차중' : '출차완료'}
            </span>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">운전자</p>
                <p className="text-sm font-medium">{record.driverName}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">연락처</p>
                <p className="text-sm">{record.driverPhone}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">소속</p>
                <p className="text-sm">{record.driverCompany}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">목적</p>
                <p className="text-sm">{record.purpose}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">입차 시간</p>
                <p className="text-sm">{formatDt(record.entryTime)}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase font-semibold">
                  {record.exitTime ? '출차 시간' : '주차 시간'}
                </p>
                <p className="text-sm">
                  {record.exitTime ? formatDt(record.exitTime) : duration()}
                </p>
              </div>
            </div>
          </div>

          {/* 입차 사진 */}
          <PhotoGrid photos={record.entryPhotos} label="입차" />

          {/* 출차 사진 */}
          {record.exitPhotos.length > 0 && (
            <PhotoGrid photos={record.exitPhotos} label="출차" />
          )}

          {/* 알림 상태 */}
          {record.notificationSent && record.recipientName && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-xl text-sm text-green-700">
              <Check size={16} />
              <span>{record.recipientName}님에게 출고 알림 전송 완료 ({record.recipientEmail})</span>
            </div>
          )}

          {/* 출차 처리 폼 */}
          {record.status === 'parked' && !showDepartureForm && (
            <button
              onClick={() => setShowDepartureForm(true)}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <ArrowRightLeft size={16} /> 출차 처리
            </button>
          )}

          {showDepartureForm && (
            <div className="border-t pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Send size={14} /> 출차 처리 및 담당자 알림
              </h4>
              <div className="bg-blue-50 rounded-xl px-3 py-2 text-xs text-blue-700 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>출차 시 차량 4면 사진이 자동 촬영됩니다. 도착지 담당자에게 출고 정보가 메일/문자로 전송됩니다.</span>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">도착지</label>
                <input className="input-field" placeholder="예: 부산 공장" value={destination} onChange={e => setDestination(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">담당자 이름</label>
                  <input className="input-field" placeholder="홍담당" value={recipientName} onChange={e => setRecipientName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">담당자 이메일</label>
                  <input className="input-field" placeholder="hong@kscorp.kr" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">담당자 연락처</label>
                  <input className="input-field" placeholder="010-0000-0000" value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowDepartureForm(false)} className="btn-secondary flex-1">취소</button>
                <button
                  onClick={handleDeparture}
                  disabled={sending || !destination || !recipientName}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {sending ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                  {sending ? '처리 중...' : '출차 처리 + 알림 발송'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 기본 구역 정보 (입차 등록용) ── */
const DEFAULT_ZONES: Record<Zone, { label: string; total: number }> = {
  A: { label: 'A구역', total: 20 },
  B: { label: 'B구역', total: 15 },
  C: { label: 'C구역', total: 10 },
};

/* ── 입차 등록 모달 ── */
function EntryModal({
  onClose,
  onRegister,
}: {
  onClose: () => void;
  onRegister: (record: ParkingRecord) => void;
}) {
  const [plate, setPlate] = useState('');
  const [zone, setZone] = useState<Zone>('A');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverCompany, setDriverCompany] = useState('');
  const [purpose, setPurpose] = useState('');
  const [recognizing, setRecognizing] = useState(false);

  const handleRecognize = async () => {
    setRecognizing(true);
    await new Promise(r => setTimeout(r, 1200));
    // 시뮬레이션: 자동 인식된 번호판
    setPlate(`${Math.floor(Math.random() * 90 + 10)}${['가','나','다','라','마'][Math.floor(Math.random()*5)]} ${Math.floor(Math.random() * 9000 + 1000)}`);
    setRecognizing(false);
  };

  // 빈 자리 찾기
  const getNextSpot = (z: Zone): string => {
    const total = DEFAULT_ZONES[z].total;
    for (let i = 1; i <= total; i++) {
      const spot = `${z}-${String(i).padStart(2, '0')}`;
      // 실제에서는 서버에서 확인
      return spot;
    }
    return `${z}-01`;
  };

  const handleSubmit = () => {
    if (!plate || !driverName) return;
    const spot = getNextSpot(zone);
    const now = new Date().toISOString();
    const record: ParkingRecord = {
      id: `p-${Date.now()}`,
      plateNumber: plate,
      zone,
      spot,
      status: 'parked',
      entryTime: now,
      driverName,
      driverPhone,
      driverCompany,
      purpose,
      entryPhotos: [
        { direction: '전면', url: '', timestamp: now },
        { direction: '후면', url: '', timestamp: now },
        { direction: '좌측', url: '', timestamp: now },
        { direction: '우측', url: '', timestamp: now },
      ],
      exitPhotos: [],
      notificationSent: false,
    };
    onRegister(record);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 text-lg">입차 등록</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          {/* 번호판 인식 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">차량번호</label>
            <div className="flex gap-2">
              <input className="input-field flex-1 text-lg font-bold tracking-wider" placeholder="12가 3456" value={plate} onChange={e => setPlate(e.target.value)} />
              <button onClick={handleRecognize} disabled={recognizing} className="btn-secondary flex items-center gap-1 px-3">
                {recognizing ? <RefreshCw size={14} className="animate-spin" /> : <Camera size={14} />}
                {recognizing ? '인식중' : '자동인식'}
              </button>
            </div>
          </div>

          {/* 구역 선택 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">주차 구역</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(DEFAULT_ZONES) as Zone[]).map(z => (
                <button
                  key={z}
                  onClick={() => setZone(z)}
                  className={`p-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
                    zone === z
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {DEFAULT_ZONES[z].label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* 운전자 정보 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">운전자 이름 *</label>
              <input className="input-field" placeholder="이름" value={driverName} onChange={e => setDriverName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">연락처</label>
              <input className="input-field" placeholder="010-0000-0000" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">소속</label>
            <input className="input-field" placeholder="회사/부서명" value={driverCompany} onChange={e => setDriverCompany(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">방문 목적</label>
            <input className="input-field" placeholder="자재 입고, 미팅 등" value={purpose} onChange={e => setPurpose(e.target.value)} />
          </div>

          {/* 사진 안내 */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-primary-50 rounded-xl text-xs text-primary-700">
            <Camera size={14} className="flex-shrink-0 mt-0.5" />
            <span>등록 시 차량 4면 (전면/후면/좌측/우측) 사진이 자동으로 촬영 및 저장됩니다.</span>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!plate || !driverName}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Car size={16} /> 입차 등록
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 실시간 차량 추적 패널 ── */
const DETECTION_API = 'http://localhost:8200';

interface CameraState {
  camera_id: string;
  name: string;
  url: string;
  status: string;
  fps: number;
  frame_count: number;
  last_error: string;
  resolution: [number, number];
}

function LiveTrackingPanel({ activeCameraId, onActiveCameraChange }: {
  activeCameraId: string | null;
  onActiveCameraChange: (id: string | null) => void;
}) {
  // 연결 폼
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('554');
  const [protocol, setProtocol] = useState<'rtsp' | 'http'>('rtsp');
  const [streamPath, setStreamPath] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [targetFps, setTargetFps] = useState(20);
  const [minArea, setMinArea] = useState(800);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 상태
  const [cameras, setCameras] = useState<CameraState[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const statusRef = useRef<number | null>(null);

  // 카메라 목록 조회
  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${DETECTION_API}/api/cameras`);
      const data = await res.json();
      setCameras(data.cameras || []);
    } catch { /* 서버 오프라인 */ }
  }, []);

  useEffect(() => {
    fetchCameras();
    // 상태 폴링 (1초마다)
    statusRef.current = window.setInterval(fetchCameras, 2000);
    return () => {
      if (statusRef.current) clearInterval(statusRef.current);
    };
  }, []);

  // 카메라 연결
  const handleConnect = async () => {
    if (!ip || !port) return;
    setError('');
    setConnecting(true);

    try {
      const res = await fetch(`${DETECTION_API}/api/cameras`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip, port: Number(port), protocol, name: cameraName || `${ip}:${port}`,
          path: streamPath, username, password,
          target_fps: targetFps, min_area: minArea,
        }),
      });
      const data = await res.json();

      if (data.success) {
        onActiveCameraChange(data.camera_id);
        await fetchCameras();
        setIp(''); setPort(protocol === 'rtsp' ? '554' : '80');
        setCameraName(''); setStreamPath('');
      } else {
        setError(data.error || '카메라 연결에 실패했습니다.');
      }
    } catch (e: any) {
      setError('감지 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
    } finally {
      setConnecting(false);
    }
  };

  // 카메라 선택
  const selectCamera = (camId: string) => {
    onActiveCameraChange(camId);
  };

  // 카메라 연결 해제
  const handleDisconnect = async (camId: string) => {
    try {
      await fetch(`${DETECTION_API}/api/cameras/${camId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    if (activeCameraId === camId) {
      onActiveCameraChange(null);
    }
    await fetchCameras();
  };

  // 활성 카메라 정보
  const activeCam = cameras.find(c => c.camera_id === activeCameraId);
  const streamUrl = activeCameraId ? `${DETECTION_API}/api/cameras/${activeCameraId}/stream` : null;

  return (
    <div className="card p-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Car size={16} className="text-primary-500" /> 실시간 차량 추적
      </h3>

      <div className="grid grid-cols-3 gap-4">
        {/* 좌측: 카메라 연결 + 목록 */}
        <div className="space-y-3">
          {/* 카메라 연결 폼 */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-600 flex items-center gap-1">
              <Wifi size={12} /> 카메라 연결
            </p>

            {/* 프로토콜 선택 */}
            <div className="flex gap-1">
              {(['rtsp', 'http'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => { setProtocol(p); setPort(p === 'rtsp' ? '554' : '80'); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    protocol === p ? 'bg-primary-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>

            {/* IP + Port */}
            <div className="flex gap-2">
              <input
                className="input-field flex-1 text-sm"
                placeholder="카메라 IP (예: 192.168.1.100)"
                value={ip} onChange={e => setIp(e.target.value)}
              />
              <input
                className="input-field w-20 text-sm text-center"
                placeholder="포트"
                value={port} onChange={e => setPort(e.target.value)}
              />
            </div>

            {/* 카메라 이름 */}
            <input
              className="input-field text-sm"
              placeholder="카메라 이름 (선택)"
              value={cameraName} onChange={e => setCameraName(e.target.value)}
            />

            {/* 고급 설정 토글 */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              <Settings2 size={11} />
              {showAdvanced ? '고급 설정 접기' : '고급 설정'}
            </button>

            {showAdvanced && (
              <div className="space-y-2 border-t border-gray-200 pt-2">
                <input
                  className="input-field text-xs"
                  placeholder="스트림 경로 (예: /stream, /live)"
                  value={streamPath} onChange={e => setStreamPath(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input-field text-xs"
                    placeholder="사용자명"
                    value={username} onChange={e => setUsername(e.target.value)}
                  />
                  <input
                    className="input-field text-xs"
                    type="password"
                    placeholder="비밀번호"
                    value={password} onChange={e => setPassword(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-500 whitespace-nowrap">목표 FPS</label>
                  <input
                    type="range" min="5" max="30" step="5"
                    value={targetFps}
                    onChange={e => setTargetFps(Number(e.target.value))}
                    className="flex-1 accent-primary-500"
                  />
                  <span className="text-[10px] font-mono text-gray-500 w-8">{targetFps}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-500 whitespace-nowrap">감도</label>
                  <input
                    type="range" min="200" max="3000" step="200"
                    value={minArea}
                    onChange={e => setMinArea(Number(e.target.value))}
                    className="flex-1 accent-primary-500"
                  />
                  <span className="text-[10px] font-mono text-gray-500 w-10">{minArea}px</span>
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> {error}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={connecting || !ip}
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            >
              {connecting ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {connecting ? '연결 중...' : '연결 및 추적 시작'}
            </button>
          </div>

          {/* 연결된 카메라 목록 */}
          {cameras.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500">연결된 카메라</p>
              {cameras.map(cam => (
                <div
                  key={cam.camera_id}
                  onClick={() => selectCamera(cam.camera_id)}
                  className={`flex items-center gap-2 p-2.5 rounded-xl cursor-pointer transition-colors ${
                    activeCameraId === cam.camera_id
                      ? 'bg-primary-50 border border-primary-200'
                      : 'bg-white border border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    cam.status === 'connected' ? 'bg-green-500 animate-pulse' :
                    cam.status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                    cam.status === 'error' ? 'bg-red-500' : 'bg-gray-300'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{cam.name}</p>
                    <p className="text-[10px] text-gray-400">{cam.fps} FPS | {cam.resolution?.[0]}x{cam.resolution?.[1]}</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDisconnect(cam.camera_id); }}
                    className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500"
                  >
                    <Square size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 우측: 실시간 영상 (MJPEG 스트림) */}
        <div className="col-span-2 space-y-3">
          {streamUrl ? (
            <>
              <div className="relative rounded-2xl overflow-hidden bg-black">
                <img
                  src={streamUrl}
                  alt="실시간 차량 추적"
                  className="w-full"
                />
                {/* 상태 오버레이 */}
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <span className="flex items-center gap-1.5 bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                    <Radio size={10} className="animate-pulse" /> LIVE
                  </span>
                  {activeCam && (
                    <span className="bg-black/60 text-white text-[10px] px-2 py-1 rounded-full">
                      {activeCam.name}
                    </span>
                  )}
                </div>
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  {activeCam && (
                    <>
                      <span className="bg-black/60 text-green-400 text-[10px] font-mono px-2 py-1 rounded-full">
                        {activeCam.fps} FPS
                      </span>
                      <span className="bg-primary-600 text-white text-[10px] font-bold px-2 py-1 rounded-full">
                        {(activeCam as any).active_objects || 0} 추적 중
                      </span>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="h-80 flex items-center justify-center bg-gray-50 rounded-2xl">
              <div className="text-center text-gray-300">
                <Video size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium text-gray-400">카메라를 연결하면</p>
                <p className="text-sm font-medium text-gray-400">실시간 차량 추적이 시작됩니다</p>
                <div className="mt-4 text-xs text-gray-300 space-y-1">
                  <p>RTSP: rtsp://IP:554/stream</p>
                  <p>HTTP: http://IP:80/video</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── AI 주차 추적 패널 (이미지 업로드 + 구역/라인 설정) ── */

interface DetectionResult {
  success: boolean;
  elapsed_ms: number;
  image_size: [number, number];
  total_detected: number;
  zone_summary: Record<string, {
    name: string; occupied: number; total: number;
    available: number; occupancy_rate: number; color: string;
  }>;
  vehicles: {
    cx: number; cy: number; confidence: number;
    class: string; zone: string | null; spot_label: string | null;
  }[];
  result_image_base64?: string;
}

function AiTrackingPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [confidence, setConfidence] = useState(0.35);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const checkApi = useCallback(async () => {
    try {
      const res = await fetch(`${DETECTION_API}/health`);
      const data = await res.json();
      setApiOnline(data.model_loaded === true);
    } catch {
      setApiOnline(false);
    }
  }, []);

  const handleFile = async (file: File) => {
    setError('');
    setResult(null);

    // 미리보기
    const reader = new FileReader();
    reader.onload = (e) => setPreviewSrc(e.target?.result as string);
    reader.readAsDataURL(file);

    // 감지 요청
    setDetecting(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch(
        `${DETECTION_API}/api/detect/visual?confidence=${confidence}`,
        { method: 'POST', body: form },
      );
      if (!res.ok) throw new Error(`API 오류: ${res.status}`);
      const data: DetectionResult = await res.json();
      setResult(data);
      if (data.result_image_base64) setPreviewSrc(data.result_image_base64);
    } catch (e: any) {
      setError(e.message || '감지 서버에 연결할 수 없습니다.');
    } finally {
      setDetecting(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) handleFile(file);
  }, [confidence]);

  const zoneColors: Record<string, string> = {
    A: 'bg-blue-500', B: 'bg-primary-500', C: 'bg-yellow-500',
  };

  return (
    <div className="card p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Cpu size={16} className="text-primary-500" /> AI 주차 추적
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={checkApi} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <RefreshCw size={12} /> 상태 확인
          </button>
          {apiOnline !== null && (
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
              apiOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              {apiOnline ? '연결됨' : '오프라인'}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 좌측: 업로드 + 설정 */}
        <div className="space-y-3">
          {/* 드롭존 */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {previewSrc ? (
              <img src={previewSrc} alt="주차장 이미지" className="w-full rounded-xl max-h-64 object-contain" />
            ) : (
              <div className="py-6">
                <Upload size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">주차장 이미지를 드래그하거나 클릭하여 업로드</p>
                <p className="text-xs text-gray-400 mt-1">JPEG, PNG 지원</p>
              </div>
            )}
          </div>

          {/* 신뢰도 조절 */}
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 whitespace-nowrap">감지 신뢰도</label>
            <input
              type="range" min="0.1" max="0.9" step="0.05"
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="flex-1 accent-primary-500"
            />
            <span className="text-xs font-mono font-semibold text-primary-600 w-10 text-right">
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>

          {detecting && (
            <div className="flex items-center gap-2 text-sm text-primary-600 bg-primary-50 rounded-xl px-4 py-3">
              <RefreshCw size={14} className="animate-spin" /> YOLOv8 Nano 추론 중...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        {/* 우측: 감지 결과 */}
        <div className="space-y-3">
          {result ? (
            <>
              {/* 결과 요약 */}
              <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye size={16} className="text-primary-500" />
                    <span className="text-sm font-semibold text-gray-800">감지 결과</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Zap size={12} /> {result.elapsed_ms}ms
                    <span className="mx-1">|</span>
                    {result.image_size[0]}x{result.image_size[1]}
                  </div>
                </div>

                <div className="text-center py-2">
                  <p className="text-3xl font-bold text-primary-600">{result.total_detected}</p>
                  <p className="text-xs text-gray-500">차량 감지됨</p>
                </div>

                {/* 구역별 현황 */}
                <div className="space-y-2">
                  {Object.entries(result.zone_summary).map(([zoneId, info]) => (
                    <div key={zoneId} className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${zoneColors[zoneId] || 'bg-gray-400'}`} />
                      <span className="text-xs font-medium text-gray-600 w-28">{info.name}</span>
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${zoneColors[zoneId] || 'bg-gray-400'}`}
                          style={{ width: `${info.occupancy_rate}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-500 w-12 text-right">
                        {info.occupied}/{info.total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 감지 차량 목록 */}
              {result.vehicles.length > 0 && (
                <div className="bg-gray-50 rounded-2xl p-4 max-h-48 overflow-y-auto">
                  <p className="text-xs font-semibold text-gray-500 mb-2">감지 차량 상세</p>
                  <div className="space-y-1.5">
                    {result.vehicles.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-2">
                        <Car size={12} className="text-gray-400" />
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          v.zone === 'A' ? 'bg-blue-100 text-blue-700' :
                          v.zone === 'B' ? 'bg-primary-100 text-primary-700' :
                          v.zone === 'C' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {v.spot_label || '구역외'}
                        </span>
                        <span className="text-gray-500">{v.class}</span>
                        <span className="ml-auto font-mono text-gray-400">
                          {(v.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-300 py-12">
              <div className="text-center">
                <Cpu size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">주차장 이미지를 업로드하면</p>
                <p className="text-sm">AI가 차량을 자동 감지합니다</p>
                <p className="text-xs text-gray-400 mt-2">YOLOv8 Nano | COCO 사전학습</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 구역/라인 설정 패널 (관리자 전용) ── */

interface ParkingEventData {
  type: 'entry' | 'exit';
  trackId?: number;
  plateNumber?: string;
  lineName?: string;
  direction?: string;
  timestamp: string;
  zone?: { name: string; label: string };
}

function ZoneConfigPanel({ activeCameraId }: { activeCameraId: string | null }) {
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const [zones, setZones] = useState<ZoneData[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showLineForm, setShowLineForm] = useState<string | null>(null);

  // 새 구역 폼
  const [newZone, setNewZone] = useState({ name: '', label: '', x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, totalSpots: 0 });
  // 새 라인 폼
  const [newLine, setNewLine] = useState({ name: '', type: 'both' as const, x1: 0.0, y1: 0.5, x2: 1.0, y2: 0.5 });

  const fetchZones = useCallback(async () => {
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch('http://localhost:3000/api/parking/zones', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setZones(data.data);
    } catch { /* offline */ }
  }, []);

  useEffect(() => { fetchZones(); }, [fetchZones]);

  // 구역을 detection 서버에 적용
  const applyConfig = useCallback(async (updatedZones?: ZoneData[]) => {
    if (!activeCameraId) return;
    const zoneList = updatedZones || zones;
    const allLines: any[] = [];
    const allZones: any[] = [];

    for (const z of zoneList) {
      allZones.push({ id: z.id, name: z.name, label: z.label, x1: z.x1, y1: z.y1, x2: z.x2, y2: z.y2 });
      for (const l of (z.lines || [])) {
        allLines.push({ id: l.id, name: l.name, type: l.type, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, zone_id: z.id });
      }
    }

    try {
      await fetch(`${DETECTION_API}/api/parking/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_id: activeCameraId, zones: allZones, lines: allLines }),
      });
    } catch { /* detection server offline */ }
  }, [activeCameraId, zones]);

  const handleAddZone = async () => {
    setLoading(true);
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch('http://localhost:3000/api/parking/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...newZone, cameraId: activeCameraId }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchZones();
        setShowForm(false);
        setNewZone({ name: '', label: '', x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, totalSpots: 0 });
      }
    } catch { /* error */ }
    setLoading(false);
  };

  const handleDeleteZone = async (zoneId: string) => {
    try {
      const token = useAuthStore.getState().accessToken;
      await fetch(`http://localhost:3000/api/parking/zones/${zoneId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchZones();
    } catch { /* error */ }
  };

  const handleAddLine = async (zoneId: string) => {
    setLoading(true);
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`http://localhost:3000/api/parking/zones/${zoneId}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newLine),
      });
      const data = await res.json();
      if (data.success) {
        await fetchZones();
        setShowLineForm(null);
        setNewLine({ name: '', type: 'both', x1: 0.0, y1: 0.5, x2: 1.0, y2: 0.5 });
      }
    } catch { /* error */ }
    setLoading(false);
  };

  const handleDeleteLine = async (lineId: string) => {
    try {
      const token = useAuthStore.getState().accessToken;
      await fetch(`http://localhost:3000/api/parking/lines/${lineId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchZones();
    } catch { /* error */ }
  };

  // 구역 변경 시 자동 적용
  useEffect(() => {
    if (activeCameraId && zones.length > 0) {
      applyConfig(zones);
    }
  }, [zones, activeCameraId]);

  if (!isAdmin) return null;

  return (
    <div className="card p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Shield size={16} className="text-primary-500" /> 주차 구역 설정
          <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">관리자</span>
        </h3>
        <div className="flex items-center gap-2">
          {activeCameraId && (
            <button onClick={() => applyConfig()} className="text-xs text-primary-500 hover:text-primary-700 flex items-center gap-1">
              <RefreshCw size={12} /> 카메라에 적용
            </button>
          )}
          <button onClick={() => setShowForm(!showForm)} className="text-xs bg-primary-500 text-white px-2 py-1 rounded-lg flex items-center gap-1">
            <Plus size={12} /> 구역 추가
          </button>
        </div>
      </div>

      {/* 구역 추가 폼 */}
      {showForm && (
        <div className="bg-gray-50 rounded-xl p-3 mb-3 space-y-2">
          <div className="grid grid-cols-4 gap-2">
            <input className="input-field text-xs" placeholder="구역명 (예: A구역)" value={newZone.name} onChange={e => setNewZone(z => ({ ...z, name: e.target.value }))} />
            <input className="input-field text-xs" placeholder="라벨 (예: A)" value={newZone.label} onChange={e => setNewZone(z => ({ ...z, label: e.target.value }))} />
            <input className="input-field text-xs" placeholder="주차면 수" type="number" value={newZone.totalSpots || ''} onChange={e => setNewZone(z => ({ ...z, totalSpots: Number(e.target.value) }))} />
            <button onClick={handleAddZone} disabled={loading || !newZone.name} className="btn-primary text-xs">저장</button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-gray-500">X1</label>
              <input type="range" min="0" max="1" step="0.05" value={newZone.x1} onChange={e => setNewZone(z => ({ ...z, x1: Number(e.target.value) }))} className="flex-1 accent-primary-500" />
              <span className="text-[10px] text-gray-400 w-8">{newZone.x1.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-gray-500">Y1</label>
              <input type="range" min="0" max="1" step="0.05" value={newZone.y1} onChange={e => setNewZone(z => ({ ...z, y1: Number(e.target.value) }))} className="flex-1 accent-primary-500" />
              <span className="text-[10px] text-gray-400 w-8">{newZone.y1.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-gray-500">X2</label>
              <input type="range" min="0" max="1" step="0.05" value={newZone.x2} onChange={e => setNewZone(z => ({ ...z, x2: Number(e.target.value) }))} className="flex-1 accent-primary-500" />
              <span className="text-[10px] text-gray-400 w-8">{newZone.x2.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-gray-500">Y2</label>
              <input type="range" min="0" max="1" step="0.05" value={newZone.y2} onChange={e => setNewZone(z => ({ ...z, y2: Number(e.target.value) }))} className="flex-1 accent-primary-500" />
              <span className="text-[10px] text-gray-400 w-8">{newZone.y2.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 구역 목록 */}
      {zones.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">설정된 구역이 없습니다. 구역을 추가하세요.</p>
      ) : (
        <div className="space-y-2">
          {zones.map(zone => (
            <div key={zone.id} className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center">{zone.label}</span>
                  <span className="text-sm font-medium text-gray-700">{zone.name}</span>
                  <span className="text-[10px] text-gray-400">{zone.totalSpots}면</span>
                  <span className="text-[10px] text-gray-300">({zone.x1.toFixed(2)},{zone.y1.toFixed(2)})→({zone.x2.toFixed(2)},{zone.y2.toFixed(2)})</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowLineForm(showLineForm === zone.id ? null : zone.id)} className="text-xs text-primary-500 hover:text-primary-700 px-2 py-1">
                    <Plus size={12} className="inline mr-1" />라인
                  </button>
                  <button onClick={() => handleDeleteZone(zone.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* 라인 추가 폼 */}
              {showLineForm === zone.id && (
                <div className="mt-2 bg-gray-50 rounded-lg p-2 space-y-2">
                  <div className="grid grid-cols-5 gap-2">
                    <input className="input-field text-xs" placeholder="라인명" value={newLine.name} onChange={e => setNewLine(l => ({ ...l, name: e.target.value }))} />
                    <select className="input-field text-xs" value={newLine.type} onChange={e => setNewLine(l => ({ ...l, type: e.target.value as any }))}>
                      <option value="entry">입차</option>
                      <option value="exit">출차</option>
                      <option value="both">양방향</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-gray-500">Y</label>
                      <input type="range" min="0" max="1" step="0.05" value={newLine.y1} onChange={e => setNewLine(l => ({ ...l, y1: Number(e.target.value), y2: Number(e.target.value) }))} className="flex-1 accent-primary-500" />
                      <span className="text-[10px] text-gray-400">{newLine.y1.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="text-[10px] text-gray-500">X범위</label>
                      <input type="range" min="0" max="1" step="0.05" value={newLine.x1} onChange={e => setNewLine(l => ({ ...l, x1: Number(e.target.value) }))} className="flex-1 accent-primary-500" />
                      <span className="text-[10px] text-gray-400">{newLine.x1.toFixed(2)}~{newLine.x2.toFixed(2)}</span>
                    </div>
                    <button onClick={() => handleAddLine(zone.id)} disabled={loading || !newLine.name} className="btn-primary text-xs">추가</button>
                  </div>
                </div>
              )}

              {/* 라인 목록 */}
              {(zone.lines || []).length > 0 && (
                <div className="mt-2 space-y-1">
                  {zone.lines!.map(line => (
                    <div key={line.id} className="flex items-center gap-2 text-xs text-gray-500 pl-8">
                      <span className={`w-1.5 h-1.5 rounded-full ${line.type === 'entry' ? 'bg-green-500' : line.type === 'exit' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                      <span>{line.name}</span>
                      <span className="text-[10px] text-gray-300">
                        {line.type === 'entry' ? '입차' : line.type === 'exit' ? '출차' : '양방향'}
                      </span>
                      <span className="text-[10px] text-gray-300">
                        ({line.x1.toFixed(2)},{line.y1.toFixed(2)})→({line.x2.toFixed(2)},{line.y2.toFixed(2)})
                      </span>
                      <button onClick={() => handleDeleteLine(line.id)} className="p-0.5 hover:text-red-500 ml-auto">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 입출차 이벤트 로그 패널 ── */

function EventLogPanel({ activeCameraId }: { activeCameraId: string | null }) {
  const [events, setEvents] = useState<ParkingEventData[]>([]);
  const [backendEvents, setBackendEvents] = useState<ParkingEventData[]>([]);
  const pollRef = useRef<number | null>(null);

  // detection 서버에서 실시간 이벤트 폴링
  useEffect(() => {
    if (!activeCameraId) return;

    const poll = async () => {
      try {
        const res = await fetch(`${DETECTION_API}/api/parking/events/${activeCameraId}`);
        const data = await res.json();
        if (data.events) setEvents(data.events);
      } catch { /* offline */ }
    };

    poll();
    pollRef.current = window.setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeCameraId]);

  // 백엔드에서 저장된 이벤트 조회
  useEffect(() => {
    const fetch_ = async () => {
      try {
        const token = useAuthStore.getState().accessToken;
        const res = await fetch('http://localhost:3000/api/parking/events?limit=20', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) setBackendEvents(data.data.events);
      } catch { /* offline */ }
    };
    fetch_();
    const iv = setInterval(fetch_, 10000);
    return () => clearInterval(iv);
  }, []);

  const allEvents = useMemo(() => {
    // 실시간 이벤트 우선, 중복 제거
    const map = new Map<string, ParkingEventData>();
    for (const e of events) {
      map.set(`${e.trackId}-${e.timestamp}`, e);
    }
    for (const e of backendEvents) {
      const key = `${e.trackId}-${e.timestamp}`;
      if (!map.has(key)) map.set(key, e);
    }
    return Array.from(map.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 30);
  }, [events, backendEvents]);

  return (
    <div className="card p-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Activity size={16} className="text-primary-500" /> 입출차 기록
        {allEvents.length > 0 && (
          <span className="text-[10px] bg-primary-100 text-primary-600 px-1.5 py-0.5 rounded-full">{allEvents.length}건</span>
        )}
      </h3>

      {allEvents.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">
          입출차 기록이 없습니다. 구역에 라인을 설정하고 차량이 라인을 통과하면 기록됩니다.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {allEvents.map((ev, i) => (
            <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${
              ev.type === 'entry' ? 'bg-green-50' : 'bg-red-50'
            }`}>
              {ev.type === 'entry' ? (
                <LogIn size={14} className="text-green-600 flex-shrink-0" />
              ) : (
                <LogOut size={14} className="text-red-600 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${ev.type === 'entry' ? 'text-green-700' : 'text-red-700'}`}>
                    {ev.type === 'entry' ? '입차' : '출차'}
                  </span>
                  {ev.plateNumber && (
                    <span className="text-xs font-mono font-bold text-gray-800 bg-white px-1.5 py-0.5 rounded border">
                      {ev.plateNumber}
                    </span>
                  )}
                  {ev.trackId !== undefined && (
                    <span className="text-[10px] text-gray-400">#{ev.trackId}</span>
                  )}
                  {ev.lineName && (
                    <span className="text-[10px] text-gray-400">{ev.lineName}</span>
                  )}
                  {ev.direction && (
                    <span className="text-[10px] text-gray-300">→{ev.direction}</span>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-gray-400 flex-shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 메인 Parking 페이지 ── */
export default function ParkingPage() {
  const [records, setRecords] = useState<ParkingRecord[]>(DEMO_RECORDS);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'parked' | 'departed'>('all');
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ParkingRecord | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [dbZones, setDbZones] = useState<ZoneData[]>([]);

  // DB에서 구역 불러오기
  useEffect(() => {
    const fetchZones = async () => {
      try {
        const token = useAuthStore.getState().accessToken;
        const res = await fetch('http://localhost:3000/api/parking/zones', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) setDbZones(data.data);
      } catch { /* offline */ }
    };
    fetchZones();
    const iv = setInterval(fetchZones, 10000);
    return () => clearInterval(iv);
  }, []);

  const filtered = records.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return r.plateNumber.includes(q) || r.driverName.toLowerCase().includes(q) ||
             r.driverCompany.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime());

  const parkedCount = records.filter(r => r.status === 'parked').length;

  const handleRegister = (record: ParkingRecord) => {
    setRecords(prev => [record, ...prev]);
  };

  const handleDeparture = (id: string, data: Partial<ParkingRecord>) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, ...data } : r));
  };

  const formatTime = (d: string) => new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: string) => new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Car size={24} /> 주차관리
      </h1>

      {/* 통계 카드 */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `repeat(${Math.min((dbZones.length || 0) + 1, 4)}, 1fr)` }}>
        <div className="card py-4 flex items-center gap-4">
          <Car size={28} className="text-primary-600" />
          <div>
            <p className="text-xs text-gray-500">현재 주차</p>
            <p className="text-2xl font-bold">{parkedCount}대</p>
          </div>
        </div>
        {dbZones.slice(0, 3).map((z, idx) => {
          const occupied = records.filter(r => r.status === 'parked' && r.zone === z.label).length;
          const colors = ['text-blue-500', 'text-primary-500', 'text-yellow-500', 'text-teal-500'];
          return (
            <div key={z.id} className="card py-4 flex items-center gap-4">
              <MapPin size={28} className={colors[idx % colors.length]} />
              <div>
                <p className="text-xs text-gray-500">{z.name}</p>
                <p className="text-2xl font-bold">{occupied}<span className="text-sm text-gray-400">/{z.totalSpots || '–'}</span></p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 주차장 맵 */}
      <ParkingMap records={records} zones={dbZones} />

      {/* 실시간 카메라 트래킹 */}
      <LiveTrackingPanel activeCameraId={activeCameraId} onActiveCameraChange={setActiveCameraId} />

      {/* 주차 구역 설정 (관리자) */}
      <ZoneConfigPanel activeCameraId={activeCameraId} />

      {/* 입출차 기록 */}
      <EventLogPanel activeCameraId={activeCameraId} />

      {/* AI 주차 추적 패널 */}
      <AiTrackingPanel />

      {/* 툴바 */}
      <div className="flex items-center justify-between mt-6 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
            <Search size={16} className="text-gray-400" />
            <input
              type="text"
              className="bg-transparent text-sm outline-none w-48"
              placeholder="차량번호, 운전자, 소속 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex rounded-xl border border-gray-200 overflow-hidden">
            {(['all', 'parked', 'departed'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterStatus === s ? 'bg-primary-500 text-white' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {s === 'all' ? '전체' : s === 'parked' ? '주차중' : '출차'}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setShowEntry(true)} className="btn-primary flex items-center gap-2">
          <Car size={16} /> 입차 등록
        </button>
      </div>

      {/* 차량 목록 */}
      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-3 font-medium">차량번호</th>
              <th className="pb-3 font-medium w-20">구역</th>
              <th className="pb-3 font-medium w-24">운전자</th>
              <th className="pb-3 font-medium w-28">소속</th>
              <th className="pb-3 font-medium w-24">입차</th>
              <th className="pb-3 font-medium w-24">출차</th>
              <th className="pb-3 font-medium w-20 text-center">상태</th>
              <th className="pb-3 font-medium w-32">주차구역</th>
              <th className="pb-3 font-medium w-16 text-center">사진</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400">
                  차량 기록이 없습니다
                </td>
              </tr>
            ) : (
              filtered.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedRecord(r)}
                  className="border-b last:border-0 hover:bg-primary-50/50 cursor-pointer"
                >
                  <td className="py-3">
                    <span className="font-bold text-gray-800 tracking-wider">{r.plateNumber}</span>
                  </td>
                  <td className="py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.zone === 'A' ? 'bg-blue-100 text-blue-700' :
                      r.zone === 'B' ? 'bg-primary-100 text-primary-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      <MapPin size={10} /> {r.spot}
                    </span>
                  </td>
                  <td className="py-3 text-gray-700">{r.driverName}</td>
                  <td className="py-3 text-gray-500 text-xs">{r.driverCompany}</td>
                  <td className="py-3 text-gray-500 font-mono text-xs">
                    {formatDate(r.entryTime)} {formatTime(r.entryTime)}
                  </td>
                  <td className="py-3 text-gray-500 font-mono text-xs">
                    {r.exitTime ? `${formatDate(r.exitTime)} ${formatTime(r.exitTime)}` : '—'}
                  </td>
                  <td className="py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.status === 'parked' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {r.status === 'parked' ? '주차중' : '출차'}
                    </span>
                  </td>
                  <td className="py-3">
                    {(() => {
                      const zone = dbZones.find(z => z.label === r.zone);
                      const zoneName = zone?.name || `${r.zone}구역`;
                      const occupied = records.filter(rec => rec.status === 'parked' && rec.zone === r.zone).length;
                      const total = zone?.totalSpots || 0;
                      const available = Math.max(0, total - occupied);
                      const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
                      const zoneColor = r.zone === 'A' ? 'bg-blue-500' : r.zone === 'B' ? 'bg-green-500' : r.zone === 'C' ? 'bg-yellow-500' : 'bg-gray-400';
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${
                              total > 0 ? (pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-green-500') : zoneColor
                            }`} />
                            <span className="text-xs font-medium text-gray-700">{zoneName}</span>
                          </div>
                          {total > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden" style={{ maxWidth: 60 }}>
                                <div
                                  className={`h-full rounded-full ${
                                    pct >= 90 ? 'bg-red-400' : pct >= 60 ? 'bg-yellow-400' : 'bg-green-400'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-400">{available}석 남음</span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-400">{occupied}대 주차중</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Image size={14} className="text-gray-400" />
                      <span className="text-xs text-gray-400">
                        {r.entryPhotos.length + r.exitPhotos.length}
                      </span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 모달 */}
      {selectedRecord && (
        <VehicleDetailModal
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onDeparture={handleDeparture}
        />
      )}
      {showEntry && (
        <EntryModal
          onClose={() => setShowEntry(false)}
          onRegister={handleRegister}
        />
      )}
    </div>
  );
}
