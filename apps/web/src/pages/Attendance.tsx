import { useEffect, useState } from 'react';
import { Clock, LogIn, LogOut, Calendar, PlaneTakeoff, RefreshCw } from 'lucide-react';
import api from '../services/api';

interface AttendanceRecord {
  id: string;
  type: 'check_in' | 'check_out';
  checkTime: string;
  note?: string;
}

interface TodayStatus {
  checkIn: AttendanceRecord | null;
  checkOut: AttendanceRecord | null;
  workHours: string | null;
}

interface VacationBalance {
  totalDays: number;
  usedDays: number;
  remainDays: number;
}

interface Vacation {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  status: string;
}

const vacationTypeLabel: Record<string, string> = {
  annual: '연차', half_am: '오전반차', half_pm: '오후반차',
  sick: '병가', special: '특별휴가', compensatory: '대체휴가',
};

const statusLabel: Record<string, { text: string; color: string }> = {
  pending: { text: '대기중', color: 'bg-yellow-100 text-yellow-800' },
  approved: { text: '승인', color: 'bg-green-100 text-green-800' },
  rejected: { text: '반려', color: 'bg-red-100 text-red-800' },
  cancelled: { text: '취소', color: 'bg-gray-100 text-gray-800' },
};

export default function AttendancePage() {
  const [tab, setTab] = useState<'today' | 'monthly' | 'vacation'>('today');
  const [todayStatus, setTodayStatus] = useState<TodayStatus | null>(null);
  const [monthlyRecords, setMonthlyRecords] = useState<AttendanceRecord[]>([]);
  const [balance, setBalance] = useState<VacationBalance | null>(null);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [showVacationModal, setShowVacationModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchData();
  }, [tab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (tab === 'today') {
        const res = await api.get('/attendance/today');
        setTodayStatus(res.data.data);
      } else if (tab === 'monthly') {
        const res = await api.get('/attendance/monthly');
        setMonthlyRecords(res.data.data);
      } else {
        const [vacRes, balRes] = await Promise.all([
          api.get('/attendance/vacations'),
          api.get('/attendance/balance'),
        ]);
        setVacations(vacRes.data.data);
        setBalance(balRes.data.data);
      }
    } catch (err) {
      console.error('Attendance fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async (type: 'check_in' | 'check_out') => {
    setChecking(true);
    try {
      await api.post('/attendance/check', { type });
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '처리 중 오류가 발생했습니다');
    } finally {
      setChecking(false);
    }
  };

  const handleVacationSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/attendance/vacations', {
        type: form.get('type'),
        startDate: new Date(form.get('startDate') as string).toISOString(),
        endDate: new Date(form.get('endDate') as string).toISOString(),
        days: parseFloat(form.get('days') as string),
        reason: form.get('reason'),
      });
      setShowVacationModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '휴가 신청 중 오류가 발생했습니다');
    }
  };

  const formatTime = (dt: string) => new Date(dt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (dt: string) => new Date(dt).toLocaleDateString('ko-KR');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Clock size={24} /> 근무관리
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-primary-50/50 rounded-2xl p-1.5 w-fit">
        {[
          { key: 'today', label: '오늘', icon: Clock },
          { key: 'monthly', label: '월별 기록', icon: Calendar },
          { key: 'vacation', label: '휴가', icon: PlaneTakeoff },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === key ? 'bg-white shadow-sm text-primary-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="animate-spin text-gray-400" size={32} />
        </div>
      ) : (
        <>
          {/* Today Tab */}
          {tab === 'today' && todayStatus && (
            <div className="space-y-6">
              {/* Clock */}
              <div className="card text-center py-8">
                <p className="text-5xl font-mono font-bold text-gray-800">
                  {currentTime.toLocaleTimeString('ko-KR')}
                </p>
                <p className="text-gray-500 mt-2">
                  {currentTime.toLocaleDateString('ko-KR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>

              {/* Check Buttons */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleCheck('check_in')}
                  disabled={checking || !!todayStatus.checkIn}
                  className={`card py-6 text-center transition-all ${
                    todayStatus.checkIn
                      ? 'bg-green-50 border-green-200'
                      : 'hover:bg-primary-50 hover:border-primary-300 cursor-pointer'
                  }`}
                >
                  <LogIn size={32} className={`mx-auto mb-2 ${todayStatus.checkIn ? 'text-green-600' : 'text-gray-400'}`} />
                  <p className="font-semibold text-lg">출근</p>
                  {todayStatus.checkIn ? (
                    <p className="text-green-600 font-mono mt-1">{formatTime(todayStatus.checkIn.checkTime)}</p>
                  ) : (
                    <p className="text-gray-400 text-sm mt-1">미체크</p>
                  )}
                </button>
                <button
                  onClick={() => handleCheck('check_out')}
                  disabled={checking || !!todayStatus.checkOut}
                  className={`card py-6 text-center transition-all ${
                    todayStatus.checkOut
                      ? 'bg-primary-50 border-primary-200'
                      : 'hover:bg-primary-50 hover:border-primary-300 cursor-pointer'
                  }`}
                >
                  <LogOut size={32} className={`mx-auto mb-2 ${todayStatus.checkOut ? 'text-primary-600' : 'text-gray-400'}`} />
                  <p className="font-semibold text-lg">퇴근</p>
                  {todayStatus.checkOut ? (
                    <p className="text-primary-600 font-mono mt-1">{formatTime(todayStatus.checkOut.checkTime)}</p>
                  ) : (
                    <p className="text-gray-400 text-sm mt-1">미체크</p>
                  )}
                </button>
              </div>

              {todayStatus.workHours && (
                <div className="card text-center py-4 bg-primary-50/50">
                  <p className="text-gray-500 text-sm">오늘 근무 시간</p>
                  <p className="text-2xl font-bold text-primary-700 mt-1">{todayStatus.workHours}</p>
                </div>
              )}
            </div>
          )}

          {/* Monthly Tab */}
          {tab === 'monthly' && (
            <div className="card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium">날짜</th>
                    <th className="pb-3 font-medium">구분</th>
                    <th className="pb-3 font-medium">시간</th>
                    <th className="pb-3 font-medium">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRecords.length === 0 ? (
                    <tr><td colSpan={4} className="py-8 text-center text-gray-400">기록이 없습니다</td></tr>
                  ) : (
                    monthlyRecords.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-primary-50/50">
                        <td className="py-3">{formatDate(r.checkTime)}</td>
                        <td className="py-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            r.type === 'check_in' ? 'bg-green-100 text-green-700' : 'bg-primary-100 text-primary-700'
                          }`}>
                            {r.type === 'check_in' ? '출근' : '퇴근'}
                          </span>
                        </td>
                        <td className="py-3 font-mono">{formatTime(r.checkTime)}</td>
                        <td className="py-3 text-gray-500">{r.note || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Vacation Tab */}
          {tab === 'vacation' && (
            <div className="space-y-6">
              {/* Balance */}
              {balance && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="card text-center py-4">
                    <p className="text-gray-500 text-sm">총 연차</p>
                    <p className="text-2xl font-bold mt-1">{balance.totalDays}일</p>
                  </div>
                  <div className="card text-center py-4">
                    <p className="text-gray-500 text-sm">사용</p>
                    <p className="text-2xl font-bold text-red-600 mt-1">{balance.usedDays}일</p>
                  </div>
                  <div className="card text-center py-4">
                    <p className="text-gray-500 text-sm">잔여</p>
                    <p className="text-2xl font-bold text-primary-700 mt-1">{balance.remainDays}일</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={() => setShowVacationModal(true)} className="btn-primary">
                  휴가 신청
                </button>
              </div>

              <div className="card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-3 font-medium">유형</th>
                      <th className="pb-3 font-medium">기간</th>
                      <th className="pb-3 font-medium">일수</th>
                      <th className="pb-3 font-medium">사유</th>
                      <th className="pb-3 font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vacations.length === 0 ? (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">휴가 신청 내역이 없습니다</td></tr>
                    ) : (
                      vacations.map((v) => (
                        <tr key={v.id} className="border-b last:border-0 hover:bg-primary-50/50">
                          <td className="py-3">{vacationTypeLabel[v.type] || v.type}</td>
                          <td className="py-3">{formatDate(v.startDate)} ~ {formatDate(v.endDate)}</td>
                          <td className="py-3">{v.days}일</td>
                          <td className="py-3 text-gray-500">{v.reason || '-'}</td>
                          <td className="py-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${statusLabel[v.status]?.color || ''}`}>
                              {statusLabel[v.status]?.text || v.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Vacation Modal */}
      {showVacationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">휴가 신청</h3>
            <form onSubmit={handleVacationSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">유형</label>
                <select name="type" className="input-field" required>
                  {Object.entries(vacationTypeLabel).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작일</label>
                  <input type="date" name="startDate" className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종료일</label>
                  <input type="date" name="endDate" className="input-field" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">일수</label>
                <input type="number" name="days" step="0.5" min="0.5" className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">사유</label>
                <textarea name="reason" rows={3} className="input-field" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowVacationModal(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">신청</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
