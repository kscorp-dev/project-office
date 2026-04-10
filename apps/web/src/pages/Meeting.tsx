import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Video, Plus, X, Users, Clock, CalendarDays,
  Play, Square, Ban, LogIn, RefreshCw, Lock,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';

interface MeetingParticipant {
  id: string;
  userId: string;
  joinedAt?: string;
  leftAt?: string;
  isHost: boolean;
  user: { id: string; name: string; position?: string };
}

interface Meeting {
  id: string;
  title: string;
  description?: string;
  status: 'scheduled' | 'in_progress' | 'ended' | 'cancelled';
  scheduledAt: string;
  maxParticipants?: number;
  hasPassword: boolean;
  hostId: string;
  host: { id: string; name: string; position?: string };
  _count: { participants: number };
}

interface MeetingDetail extends Meeting {
  roomCode: string;
  participants: MeetingParticipant[];
  startedAt?: string;
  endedAt?: string;
}

interface MeetingStats {
  scheduled: number;
  in_progress: number;
  today: number;
  total: number;
}

const STATUS_MAP: Record<string, { label: string; color: string; pulse?: boolean }> = {
  scheduled:   { label: '예정',    color: 'bg-primary-100 text-primary-700' },
  in_progress: { label: '진행중',  color: 'bg-green-100 text-green-700', pulse: true },
  ended:       { label: '종료',    color: 'bg-gray-100 text-gray-500' },
  cancelled:   { label: '취소',    color: 'bg-red-100 text-red-600' },
};

export default function MeetingPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [stats, setStats] = useState<MeetingStats>({ scheduled: 0, in_progress: 0, today: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingDetail | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [meetRes] = await Promise.all([
        api.get('/meeting'),
      ]);
      const meetingsData = meetRes.data.data || [];
      const statRes = {
        data: {
          data: {
            scheduled: meetingsData.filter((m: any) => m.status === 'scheduled').length,
            in_progress: meetingsData.filter((m: any) => m.status === 'in_progress').length,
            today: meetingsData.filter((m: any) => {
              const d = new Date(m.scheduledAt);
              const now = new Date();
              return d.toDateString() === now.toDateString();
            }).length,
            total: meetingsData.length,
          },
        },
      };
      setMeetings(meetRes.data.data || []);
      setStats(statRes.data.data || { scheduled: 0, in_progress: 0, today: 0, total: 0 });
    } catch (err) {
      console.error('Meeting fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (id: string) => {
    try {
      const res = await api.get(`/meeting/${id}`);
      setSelectedMeeting(res.data.data);
    } catch (err) {
      console.error('Meeting detail error:', err);
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setCreating(true);
    try {
      await api.post('/meeting', {
        title: form.get('title'),
        description: form.get('description') || undefined,
        scheduledAt: new Date(form.get('scheduledAt') as string).toISOString(),
        maxParticipants: form.get('maxParticipants') ? Number(form.get('maxParticipants')) : undefined,
        password: form.get('password') || undefined,
      });
      setShowCreateModal(false);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '회의 생성 중 오류가 발생했습니다');
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await api.post(`/meeting/${id}/start`);
      fetchDetail(id);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '회의 시작 중 오류가 발생했습니다');
    }
  };

  const handleEnd = async (id: string) => {
    if (!confirm('회의를 종료하시겠습니까?')) return;
    try {
      await api.post(`/meeting/${id}/end`);
      setSelectedMeeting(null);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '회의 종료 중 오류가 발생했습니다');
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('회의를 취소하시겠습니까?')) return;
    try {
      await api.post(`/meeting/${id}/cancel`);
      setSelectedMeeting(null);
      fetchAll();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '회의 취소 중 오류가 발생했습니다');
    }
  };

  const handleJoin = async (meeting: Meeting) => {
    try {
      const res = await api.get(`/meeting/${meeting.id}/join`);
      if (res.data.success) {
        navigate(`/meeting/room/${meeting.id}`);
      }
    } catch (err: any) {
      // 권한 없음 시 안내
      const code = err.response?.data?.error?.code;
      if (code === 'NOT_INVITED') {
        alert('초대받지 않은 회의입니다');
      } else {
        // 기타 오류 시에도 입장 시도
        navigate(`/meeting/room/${meeting.id}`);
      }
    }
  };

  const formatDateTime = (dt: string) =>
    new Date(dt).toLocaleString('ko-KR', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const isHost = (m: Meeting | MeetingDetail) => m.hostId === user?.id;

  const STAT_CARDS = [
    { label: '예정된 회의',  value: stats.scheduled,   icon: CalendarDays, color: 'text-primary-600' },
    { label: '진행중',       value: stats.in_progress, icon: Play,         color: 'text-green-600' },
    { label: '오늘 예정',    value: stats.today,        icon: Clock,        color: 'text-yellow-600' },
    { label: '총 회의수',    value: stats.total,        icon: Video,        color: 'text-gray-600' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Video size={24} /> 화상회의
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {STAT_CARDS.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card py-4 flex items-center gap-4">
            <Icon size={28} className={color} />
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">전체 {meetings.length}개</p>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="btn-secondary flex items-center gap-1">
            <RefreshCw size={14} /> 새로고침
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> 회의 생성
          </button>
        </div>
      </div>

      {/* Meeting Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="animate-spin text-gray-400" size={32} />
        </div>
      ) : (
        <div className="card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 font-medium">제목</th>
                <th className="pb-3 font-medium w-28">주최자</th>
                <th className="pb-3 font-medium w-36">예정시간</th>
                <th className="pb-3 font-medium w-20 text-center">참석자수</th>
                <th className="pb-3 font-medium w-20 text-center">상태</th>
                <th className="pb-3 font-medium w-20 text-center">입장</th>
              </tr>
            </thead>
            <tbody>
              {meetings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    예정된 회의가 없습니다
                  </td>
                </tr>
              ) : (
                meetings.map((m) => {
                  const st = STATUS_MAP[m.status];
                  return (
                    <tr
                      key={m.id}
                      onClick={() => fetchDetail(m.id)}
                      className="border-b last:border-0 hover:bg-primary-50/50 cursor-pointer"
                    >
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {m.hasPassword && <Lock size={12} className="text-gray-400" />}
                          <span className="font-medium">{m.title}</span>
                        </div>
                        {m.description && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{m.description}</p>
                        )}
                      </td>
                      <td className="py-3 text-gray-600">{m.host.name}</td>
                      <td className="py-3 text-gray-600 font-mono text-xs">{formatDateTime(m.scheduledAt)}</td>
                      <td className="py-3 text-center">
                        <span className="flex items-center justify-center gap-1 text-gray-500">
                          <Users size={14} />
                          {m._count.participants}
                          {m.maxParticipants ? `/${m.maxParticipants}` : ''}
                        </span>
                      </td>
                      <td className="py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                          {st.pulse && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          )}
                          {st.label}
                        </span>
                      </td>
                      <td className="py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        {m.status === 'in_progress' && (
                          <button
                            onClick={() => handleJoin(m)}
                            className="btn-primary py-1 px-3 text-xs flex items-center gap-1 mx-auto"
                          >
                            <LogIn size={12} /> 입장
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Room Code Popup */}
      {roomCode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 w-full max-w-sm text-center shadow-xl">
            <Video size={40} className="mx-auto text-green-500 mb-4" />
            <h3 className="text-lg font-bold mb-2">회의 입장 코드</h3>
            <p className="text-3xl font-mono font-bold tracking-widest text-primary-700 bg-primary-50/50 rounded-2xl py-4 mb-4">
              {roomCode}
            </p>
            <p className="text-sm text-gray-500 mb-6">위 코드를 사용하여 회의에 입장하세요</p>
            <button onClick={() => setRoomCode(null)} className="btn-primary w-full">확인</button>
          </div>
        </div>
      )}

      {/* Meeting Detail Modal */}
      {selectedMeeting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">{selectedMeeting.title}</h3>
                {selectedMeeting.description && (
                  <p className="text-sm text-gray-500 mt-1">{selectedMeeting.description}</p>
                )}
              </div>
              <button onClick={() => setSelectedMeeting(null)} className="text-gray-400 hover:text-gray-600 ml-4">
                <X size={20} />
              </button>
            </div>

            {/* Info */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div>
                <p className="text-gray-500 text-xs mb-0.5">주최자</p>
                <p className="font-medium">{selectedMeeting.host.name}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-0.5">상태</p>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_MAP[selectedMeeting.status].color}`}>
                  {STATUS_MAP[selectedMeeting.status].pulse && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                  {STATUS_MAP[selectedMeeting.status].label}
                </span>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-0.5">예정시간</p>
                <p className="font-medium">{formatDateTime(selectedMeeting.scheduledAt)}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-0.5">최대 참석자</p>
                <p className="font-medium">{selectedMeeting.maxParticipants || 16}명 (최대 16명)</p>
              </div>
            </div>

            {/* Participants */}
            <div className="mb-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">
                참석자 ({selectedMeeting.participants.length}명)
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {selectedMeeting.participants.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">참석자 없음</p>
                ) : (
                  selectedMeeting.participants.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-primary-50/50">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs text-primary-700 font-semibold">
                          {p.user.name[0]}
                        </div>
                        <span className="text-sm">{p.user.name}</span>
                        {p.user.position && (
                          <span className="text-xs text-gray-400">{p.user.position}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {p.isHost && (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">주최자</span>
                        )}
                        {p.joinedAt && !p.leftAt && (
                          <span className="w-2 h-2 rounded-full bg-green-500" title="참석중" />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Host Actions */}
            {isHost(selectedMeeting) && (
              <div className="flex gap-2 pt-4 border-t">
                {selectedMeeting.status === 'scheduled' && (
                  <>
                    <button
                      onClick={() => handleStart(selectedMeeting.id)}
                      className="btn-primary flex items-center gap-1 flex-1 justify-center"
                    >
                      <Play size={14} /> 회의 시작
                    </button>
                    <button
                      onClick={() => handleCancel(selectedMeeting.id)}
                      className="btn-secondary flex items-center gap-1 text-red-600 hover:bg-red-50"
                    >
                      <Ban size={14} /> 취소
                    </button>
                  </>
                )}
                {selectedMeeting.status === 'in_progress' && (
                  <button
                    onClick={() => handleEnd(selectedMeeting.id)}
                    className="btn-secondary flex items-center gap-1 flex-1 justify-center text-red-600 hover:bg-red-50"
                  >
                    <Square size={14} /> 회의 종료
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Meeting Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">회의 생성</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목 *</label>
                <input type="text" name="title" className="input-field" required maxLength={100} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea name="description" rows={3} className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">예정시간 *</label>
                <input type="datetime-local" name="scheduledAt" className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">최대 참석자 수</label>
                <input type="number" name="maxParticipants" min={2} max={16} defaultValue={16} className="input-field" placeholder="최대 16명" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 (선택)</label>
                <input type="password" name="password" className="input-field" placeholder="선택사항" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary"
                >
                  취소
                </button>
                <button type="submit" disabled={creating} className="btn-primary">
                  {creating ? '생성중...' : '생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
