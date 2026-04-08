import { useAuthStore } from '../store/auth';
import { FileCheck, MessageSquare, Camera, ClipboardList, Users, Calendar } from 'lucide-react';

const modules = [
  { icon: FileCheck, label: '전자결재', count: 0, desc: '대기중인 결재', color: 'bg-blue-500' },
  { icon: MessageSquare, label: '메신저', count: 0, desc: '안읽은 메시지', color: 'bg-green-500' },
  { icon: Camera, label: 'CCTV', count: 0, desc: '등록된 카메라', color: 'bg-purple-500' },
  { icon: ClipboardList, label: '작업지시서', count: 0, desc: '진행중 작업', color: 'bg-orange-500' },
  { icon: Users, label: '조직도', count: 0, desc: '전체 인원', color: 'bg-cyan-500' },
  { icon: Calendar, label: '캘린더', count: 0, desc: '오늘 일정', color: 'bg-pink-500' },
];

export default function DashboardPage() {
  const { user } = useAuthStore();

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          안녕하세요, {user?.name}님
        </h1>
        <p className="text-gray-500 mt-1">
          {user?.department?.name} {user?.position && `| ${user.position}`}
        </p>
      </div>

      {/* Module Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {modules.map(({ icon: Icon, label, count, desc, color }) => (
          <div key={label} className="card hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{count}</p>
                <p className="text-xs text-gray-400 mt-1">{desc}</p>
              </div>
              <div className={`${color} p-3 rounded-xl`}>
                <Icon className="text-white" size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">최근 활동</h2>
        <div className="text-center py-12 text-gray-400">
          <p>아직 활동 내역이 없습니다</p>
          <p className="text-sm mt-1">Phase 1 구현이 완료되면 여기에 최근 활동이 표시됩니다</p>
        </div>
      </div>
    </div>
  );
}
