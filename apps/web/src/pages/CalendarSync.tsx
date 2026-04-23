/**
 * 캘린더 외부 동기화 설정 페이지 (v0.16.0 Phase 1)
 *
 * 라우트: /settings/calendar-sync
 *
 * 기능:
 *   - 내 구독 목록 조회
 *   - 새 구독 생성 (이름·scope·항목·알림시간 지정)
 *   - URL 복사 / 활성·비활성 토글 / 토큰 회전 / 삭제
 *   - iOS webcal:// 링크 직접 열기
 *
 * 사용자가 이 URL을 외부 캘린더 앱에 "구독"으로 추가하면,
 * OS 캘린더가 주기적으로 pull하여 일정을 표시하고 VALARM 기반 OS 알림을 울린다.
 */
import { useEffect, useState } from 'react';
import {
  Calendar, Plus, X, Copy, RefreshCw, Trash2,
  Power, PowerOff, CheckCircle2, ExternalLink, AlertCircle, Clock, Users,
} from 'lucide-react';
import { api } from '../services/api';

type Scope = 'personal' | 'personal_dept' | 'all';

interface Subscription {
  id: string;
  name: string;
  scope: Scope;
  includeVacation: boolean;
  includeMeeting: boolean;
  includeTasks: boolean;
  reminderMinutes: number[];
  isActive: boolean;
  lastAccessedAt?: string | null;
  accessCount: number;
  createdAt: string;
  feedUrl: { https: string; webcal: string };
}

const SCOPE_LABEL: Record<Scope, string> = {
  personal: '개인 일정만',
  personal_dept: '개인 + 소속 부서',
  all: '전사 일정 포함',
};

export default function CalendarSyncPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { void fetchList(); }, []);

  const fetchList = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/calendar-sync/subscriptions');
      setSubs(data.data || []);
      setError(null);
    } catch (e: unknown) {
      setError((e as Error).message || '구독 목록을 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  };

  const copyUrl = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  const openWebcal = (webcalUrl: string) => {
    window.location.href = webcalUrl;
  };

  const toggleActive = async (sub: Subscription) => {
    try {
      const { data } = await api.patch(`/calendar-sync/subscriptions/${sub.id}`, {
        isActive: !sub.isActive,
      });
      setSubs(subs.map((s) => (s.id === sub.id ? data.data : s)));
    } catch (e: unknown) {
      alert((e as Error).message || '상태 변경 실패');
    }
  };

  const regenerate = async (id: string) => {
    if (!confirm('토큰을 회전하면 기존 URL은 더 이상 작동하지 않습니다. 계속할까요?')) return;
    try {
      const { data } = await api.post(`/calendar-sync/subscriptions/${id}/regenerate`);
      setSubs(subs.map((s) => (s.id === id ? data.data : s)));
    } catch (e: unknown) {
      alert((e as Error).message || '회전 실패');
    }
  };

  const deleteSubscription = async (id: string) => {
    if (!confirm('이 구독을 영구 삭제합니다. 계속할까요?')) return;
    try {
      await api.delete(`/calendar-sync/subscriptions/${id}`);
      setSubs(subs.filter((s) => s.id !== id));
    } catch (e: unknown) {
      alert((e as Error).message || '삭제 실패');
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Calendar className="text-primary-600" size={28} />
        <h1 className="text-2xl font-bold">외부 캘린더 연동</h1>
      </div>
      <p className="text-gray-600 mb-6">
        iPhone, Google Calendar, Outlook 등에서 Project Office 일정을 볼 수 있게 URL을 발급받으세요.
        외부 캘린더 앱이 자체 알림으로 일정을 알려줍니다.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* 사용 방법 */}
      <details className="bg-primary-50 border border-primary-200 rounded-xl p-4 mb-4">
        <summary className="cursor-pointer font-medium text-primary-800">
          💡 사용 방법 (펼쳐보기)
        </summary>
        <div className="mt-3 space-y-3 text-sm text-primary-900">
          <div>
            <strong>📱 iPhone</strong>
            <ol className="ml-5 list-decimal mt-1 space-y-0.5">
              <li>아래 구독의 <code className="bg-white px-1 rounded">URL 복사</code> 클릭</li>
              <li>설정 → 캘린더 → 계정 → 계정 추가 → 기타 → "구독 캘린더 추가"</li>
              <li>URL 붙여넣기 → "다음" → "저장"</li>
              <li>또는 iOS에서 이 페이지를 열었다면 <code className="bg-white px-1 rounded">webcal로 열기</code> 클릭</li>
            </ol>
          </div>
          <div>
            <strong>🌐 Google Calendar</strong>
            <ol className="ml-5 list-decimal mt-1 space-y-0.5">
              <li>calendar.google.com 접속</li>
              <li>왼쪽 "다른 캘린더" 옆 "+" → "URL로 추가"</li>
              <li>URL 붙여넣기 → "캘린더 추가"</li>
            </ol>
          </div>
          <div className="text-xs text-primary-700 border-t border-primary-200 pt-2">
            ⚠ iOS는 기본 1시간, Google은 6~24시간 주기로 갱신합니다. 설정에서 조정 가능합니다.
          </div>
        </div>
      </details>

      {/* 구독 목록 */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">로딩 중...</div>
      ) : subs.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
          <Calendar className="mx-auto text-gray-300 mb-2" size={40} />
          <p className="text-gray-500">아직 등록된 구독이 없습니다.</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 inline-flex items-center gap-1">
            <Plus size={16} /> 첫 구독 만들기
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {subs.map((sub) => (
              <div
                key={sub.id}
                className={`border rounded-xl p-4 ${sub.isActive ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{sub.name}</h3>
                      {sub.isActive ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">활성</span>
                      ) : (
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">비활성</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 mb-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span className="flex items-center gap-1"><Users size={12} /> {SCOPE_LABEL[sub.scope]}</span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {sub.reminderMinutes.join(', ')}분 전 알림
                      </span>
                      <span className="text-gray-400">
                        {[
                          sub.includeVacation && '휴가',
                          sub.includeMeeting && '회의',
                          sub.includeTasks && '작업',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg text-xs font-mono text-gray-700 break-all">
                      <span className="flex-1">{sub.feedUrl.https}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1.5">
                      생성: {new Date(sub.createdAt).toLocaleDateString('ko-KR')}
                      {sub.lastAccessedAt && ` · 마지막 접근: ${new Date(sub.lastAccessedAt).toLocaleString('ko-KR')}`}
                      {` · 접근 횟수: ${sub.accessCount}`}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => copyUrl(sub.feedUrl.https, sub.id)}
                    className="btn-secondary text-xs flex items-center gap-1"
                  >
                    {copied === sub.id ? (
                      <><CheckCircle2 size={12} /> 복사됨</>
                    ) : (
                      <><Copy size={12} /> URL 복사</>
                    )}
                  </button>
                  <button
                    onClick={() => openWebcal(sub.feedUrl.webcal)}
                    className="btn-secondary text-xs flex items-center gap-1"
                    title="iOS 캘린더 앱으로 바로 구독 (iOS/macOS)"
                  >
                    <ExternalLink size={12} /> webcal로 열기
                  </button>
                  <button
                    onClick={() => toggleActive(sub)}
                    className="btn-secondary text-xs flex items-center gap-1"
                  >
                    {sub.isActive ? <><PowerOff size={12} /> 비활성</> : <><Power size={12} /> 활성</>}
                  </button>
                  <button
                    onClick={() => regenerate(sub.id)}
                    className="btn-secondary text-xs flex items-center gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                    title="URL을 새로 발급 (기존 URL은 무효화)"
                  >
                    <RefreshCw size={12} /> 회전
                  </button>
                  <button
                    onClick={() => deleteSubscription(sub.id)}
                    className="btn-secondary text-xs flex items-center gap-1 text-red-600 border-red-300 hover:bg-red-50 ml-auto"
                  >
                    <Trash2 size={12} /> 삭제
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-1"
          >
            <Plus size={16} /> 새 구독 추가
          </button>
        </>
      )}

      {showCreate && (
        <CreateSubscriptionModal
          onClose={() => setShowCreate(false)}
          onCreated={(sub) => {
            setSubs([sub, ...subs]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function CreateSubscriptionModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (sub: Subscription) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('personal_dept');
  const [includeVacation, setIncludeVacation] = useState(true);
  const [includeMeeting, setIncludeMeeting] = useState(true);
  const [includeTasks, setIncludeTasks] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<number[]>([10]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleReminder = (n: number) => {
    setReminderMinutes((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b),
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('이름을 입력하세요'); return; }
    if (reminderMinutes.length === 0) { setErr('알림 시간을 최소 1개 선택하세요'); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post('/calendar-sync/subscriptions', {
        name: name.trim(),
        scope,
        includeVacation,
        includeMeeting,
        includeTasks,
        reminderMinutes,
      });
      onCreated(data.data);
    } catch (e: unknown) {
      const axiosErr = e as { response?: { data?: { error?: { message?: string } } } };
      setErr(axiosErr.response?.data?.error?.message || (e as Error).message || '생성 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="text-lg font-bold">새 구독 만들기</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">이름 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="내 iPhone"
              className="input-field w-full"
              maxLength={100}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">포함 범위</label>
            <div className="space-y-1.5">
              {(['personal', 'personal_dept', 'all'] as const).map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={scope === s} onChange={() => setScope(s)} />
                  <span className="text-sm">{SCOPE_LABEL[s]}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">포함 항목</label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeVacation} onChange={(e) => setIncludeVacation(e.target.checked)} />
                <span className="text-sm">내 휴가 (승인된 것만)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeMeeting} onChange={(e) => setIncludeMeeting(e.target.checked)} />
                <span className="text-sm">내가 참여하는 회의</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeTasks} onChange={(e) => setIncludeTasks(e.target.checked)} />
                <span className="text-sm">작업지시서 마감일</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">알림 시간 (복수 선택)</label>
            <div className="flex flex-wrap gap-1.5">
              {[5, 10, 15, 30, 60].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => toggleReminder(n)}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    reminderMinutes.includes(n)
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {n}분 전
                </button>
              ))}
            </div>
          </div>

          {err && <div className="text-red-600 text-sm">{err}</div>}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">취소</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
