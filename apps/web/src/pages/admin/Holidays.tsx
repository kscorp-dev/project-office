/**
 * 관리자 공휴일 관리 페이지 (v0.19.0 — #6 UI)
 *
 * 경로: /admin/holidays
 *
 * 기능:
 *   - 연도별 공휴일 목록 + CRUD
 *   - JSON 일괄 등록 (행안부 공개 데이터 등)
 *   - 연차 자동부여 배치 수동 실행
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, Plus, Trash2,
  Upload, Play, Loader2, CheckCircle2, AlertCircle, X,
} from 'lucide-react';
import { api } from '../../services/api';

interface Holiday {
  id: string;
  date: string;
  name: string;
  type: 'legal' | 'substitute' | 'company' | 'event';
  excludeFromWorkdays: boolean;
  note?: string | null;
}

const TYPE_LABEL: Record<Holiday['type'], string> = {
  legal: '법정',
  substitute: '대체',
  company: '회사',
  event: '기념일',
};

const TYPE_COLOR: Record<Holiday['type'], string> = {
  legal: 'bg-red-100 text-red-700',
  substitute: 'bg-orange-100 text-orange-700',
  company: 'bg-blue-100 text-blue-700',
  event: 'bg-gray-100 text-gray-600',
};

export default function HolidaysPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [accrualResult, setAccrualResult] = useState<{ year: number; succeeded: number; skipped: number; failed: number } | null>(null);

  const fetchList = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/holidays?year=${year}`);
      setHolidays(data.data || []);
    } catch (e: unknown) {
      setToast({ type: 'error', message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchList(); /* eslint-disable-next-line */ }, [year]);

  const deleteItem = async (id: string) => {
    if (!confirm('이 공휴일을 삭제할까요?')) return;
    try {
      await api.delete(`/holidays/${id}`);
      setHolidays(holidays.filter((h) => h.id !== id));
    } catch (e: unknown) {
      setToast({ type: 'error', message: (e as Error).message });
    }
  };

  const runAnnualAccrual = async () => {
    if (!confirm(`${year}년 전체 직원에게 연차를 일괄 부여합니다. 계속할까요?`)) return;
    try {
      const { data } = await api.post('/holidays/accrual/annual', { year });
      setAccrualResult(data.data);
      setToast({ type: 'success', message: '연차 부여 완료' });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      setToast({
        type: 'error',
        message: err.response?.data?.error?.message || '실패',
      });
    }
  };

  const runMonthlyAccrual = async () => {
    if (!confirm('이번 달 기준 근속 1년 미만 직원에게 월차를 부여합니다. 계속할까요?')) return;
    try {
      const { data } = await api.post('/holidays/accrual/monthly');
      setAccrualResult(data.data);
      setToast({ type: 'success', message: '월차 부여 완료' });
    } catch (e: unknown) {
      setToast({ type: 'error', message: (e as Error).message });
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="text-primary-600" />
          공휴일 & 연차 관리
        </h1>
      </div>

      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}

      {/* 연차 일괄 부여 */}
      <div className="bg-white rounded-xl p-5 mb-4 border border-gray-200">
        <h2 className="font-bold mb-2">연차 자동 부여 (수동)</h2>
        <p className="text-sm text-gray-600 mb-3">
          cron이 자동 실행되지만, 수동으로도 배치를 돌릴 수 있습니다.
          근로기준법 §60 기반 근속년수 계산.
        </p>
        <div className="flex gap-2">
          <button onClick={runAnnualAccrual} className="btn-primary text-sm flex items-center gap-1">
            <Play size={14} /> {year}년 연간 부여
          </button>
          <button onClick={runMonthlyAccrual} className="btn-secondary text-sm flex items-center gap-1">
            <Play size={14} /> 이번 달 월차 부여
          </button>
        </div>
        {accrualResult && (
          <div className="mt-3 text-xs text-gray-700 bg-gray-50 rounded-lg p-3">
            <strong>결과 ({accrualResult.year})</strong>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <div>성공: {accrualResult.succeeded}</div>
              <div>건너뜀: {accrualResult.skipped}</div>
              <div>실패: {accrualResult.failed}</div>
            </div>
          </div>
        )}
      </div>

      {/* 연도 선택 + 액션 */}
      <div className="flex items-center gap-2 mb-3">
        <label className="text-sm font-medium">연도</label>
        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          className="input-field text-sm"
        >
          {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <div className="flex-1" />
        <button onClick={() => setShowBulk(true)} className="btn-secondary text-sm flex items-center gap-1">
          <Upload size={14} /> 일괄 등록
        </button>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm flex items-center gap-1">
          <Plus size={14} /> 추가
        </button>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <Loader2 size={24} className="mx-auto animate-spin" />
          </div>
        ) : holidays.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            {year}년 공휴일이 등록되어 있지 않습니다.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-3">날짜</th>
                <th className="text-left p-3">이름</th>
                <th className="text-left p-3">유형</th>
                <th className="text-center p-3">근무일 제외</th>
                <th className="text-right p-3"></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3 font-mono">{h.date.slice(0, 10)}</td>
                  <td className="p-3">
                    <div className="font-medium">{h.name}</div>
                    {h.note && <div className="text-xs text-gray-500">{h.note}</div>}
                  </td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${TYPE_COLOR[h.type]}`}>
                      {TYPE_LABEL[h.type]}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {h.excludeFromWorkdays ? '✅' : '—'}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => deleteItem(h.id)}
                      className="text-red-500 hover:bg-red-50 p-1 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(h) => {
            setHolidays([...holidays, h].sort((a, b) => a.date.localeCompare(b.date)));
            setShowCreate(false);
          }}
        />
      )}

      {showBulk && (
        <BulkModal
          onClose={() => setShowBulk(false)}
          onImported={(count) => {
            setToast({ type: 'success', message: `${count}건 등록됨` });
            setShowBulk(false);
            void fetchList();
          }}
        />
      )}
    </div>
  );
}

function CreateModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (h: Holiday) => void;
}) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Holiday['type']>('legal');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post('/holidays', {
        date, name, type, note: note || undefined,
      });
      onCreated(data.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      alert(err.response?.data?.error?.message || '등록 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold">공휴일 추가</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">날짜 *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">이름 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="설날" className="input-field w-full" required maxLength={100} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">유형</label>
            <select value={type} onChange={(e) => setType(e.target.value as Holiday['type'])} className="input-field w-full">
              <option value="legal">법정 공휴일</option>
              <option value="substitute">대체 공휴일</option>
              <option value="company">회사 지정 휴무</option>
              <option value="event">기념일 (정상 근무)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">비고</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="input-field w-full" maxLength={500} />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">취소</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? '저장 중...' : '등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkModal({
  onClose, onImported,
}: {
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [json, setJson] = useState('[\n  { "date": "2026-01-01", "name": "신정", "type": "legal" },\n  { "date": "2026-03-01", "name": "삼일절", "type": "legal" }\n]');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const items = JSON.parse(json);
      if (!Array.isArray(items)) throw new Error('JSON 배열 형식이어야 합니다');
      const { data } = await api.post('/holidays/bulk-import', { items, skipDuplicates: true });
      onImported(data.data.inserted);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      alert(err.response?.data?.error?.message || (e as Error).message || '실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold">일괄 등록 (JSON)</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <p className="text-xs text-gray-500">
            형식: <code>{`[{ date: "YYYY-MM-DD", name, type, note? }]`}</code>
            <br />중복 항목은 자동으로 건너뜁니다.
          </p>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            className="input-field w-full font-mono text-xs"
            rows={12}
            spellCheck={false}
          />
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">취소</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? '등록 중...' : '등록'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
