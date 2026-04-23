/**
 * 화상회의 자동 회의록 조회 / 편집 / 확정 페이지
 *
 * 라우트: /meeting/:id/minutes
 *
 * 상태 흐름:
 *   generating → (폴링 중) → draft → (편집) → final (잠금)
 *
 * 주요 기능:
 *   - 상태 badge + 재생성 버튼
 *   - summary / topics / decisions / actionItems 4섹션 표시
 *   - 편집 모드 (호스트/관리자만) → PATCH /meeting/:id/minutes
 *   - 확정 버튼 (호스트/관리자만) → POST /meeting/:id/minutes/finalize
 *   - 인쇄 (브라우저 PDF로)
 *   - 원문 발언 기록 펼침 (GET /meeting/:id/transcripts)
 */
import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Edit2, Save, X, Lock, RefreshCw, Printer,
  FileText, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';

interface ActionItem {
  assignee: string;
  task: string;
  dueDate?: string;
}

type MinutesStatus = 'generating' | 'draft' | 'final' | 'failed';

interface Minutes {
  id: string;
  meetingId: string;
  status: MinutesStatus;
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: ActionItem[];
  errorMessage?: string | null;
  generatedAt?: string | null;
  finalizedAt?: string | null;
  finalizedBy?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface MeetingHeader {
  id: string;
  title: string;
  description?: string;
  startedAt?: string;
  endedAt?: string;
  hostId: string;
  host: { id: string; name: string; position?: string };
}

interface Transcript {
  id: string;
  speakerId?: string | null;
  speakerName: string;
  text: string;
  timestamp: string;
}

const STATUS_META: Record<MinutesStatus, { label: string; color: string; icon: React.ReactNode }> = {
  generating: { label: 'AI 요약 생성 중', color: 'bg-amber-100 text-amber-700', icon: <Loader2 size={12} className="animate-spin" /> },
  draft:      { label: '초안 (편집 가능)', color: 'bg-blue-100 text-blue-700', icon: <Edit2 size={12} /> },
  final:      { label: '확정', color: 'bg-green-100 text-green-700', icon: <Lock size={12} /> },
  failed:     { label: '생성 실패', color: 'bg-red-100 text-red-700', icon: <AlertCircle size={12} /> },
};

export default function MeetingMinutesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [meeting, setMeeting] = useState<MeetingHeader | null>(null);
  const [minutes, setMinutes] = useState<Minutes | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [showTranscripts, setShowTranscripts] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 편집 state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    summary: string; topics: string[]; decisions: string[]; actionItems: ActionItem[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // 폴링 (generating 상태일 때 3초마다 재조회)
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void fetchAll();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // generating 상태면 폴링 시작, 그 외에는 중단
  useEffect(() => {
    if (minutes?.status === 'generating') {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => {
        void refetchMinutes();
      }, 3000);
    } else if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes?.status]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, minRes] = await Promise.all([
        api.get(`/meeting/${id}`),
        api.get(`/meeting/${id}/minutes`),
      ]);
      setMeeting(mRes.data.data);
      setMinutes(minRes.data.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      setError(err.response?.data?.error?.message || '회의록을 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  };

  const refetchMinutes = async () => {
    try {
      const { data } = await api.get(`/meeting/${id}/minutes`);
      setMinutes(data.data);
    } catch { /* ignore */ }
  };

  const isHost = !!(meeting && user && meeting.hostId === user.id);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canEdit = (isHost || isAdmin) && minutes?.status === 'draft';
  const canFinalize = (isHost || isAdmin) && minutes?.status === 'draft';
  const canRegenerate = (isHost || isAdmin) && !!minutes && minutes.status !== 'generating';

  const handleEdit = () => {
    if (!minutes) return;
    setDraft({
      summary: minutes.summary,
      topics: [...minutes.topics],
      decisions: [...minutes.decisions],
      actionItems: [...minutes.actionItems],
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/meeting/${id}/minutes`, draft);
      setMinutes(data.data);
      setEditing(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      alert(err.response?.data?.error?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!confirm('회의록을 확정하면 더 이상 편집할 수 없습니다. 계속하시겠습니까?')) return;
    try {
      const { data } = await api.post(`/meeting/${id}/minutes/finalize`);
      setMinutes(data.data);
      setEditing(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      alert(err.response?.data?.error?.message || '확정 중 오류');
    }
  };

  const handleRegenerate = async () => {
    if (!confirm('회의록을 재생성합니다. 현재 편집 내용은 사라집니다. 계속하시겠습니까?')) return;
    try {
      const force = minutes?.status === 'final' && isAdmin;
      const { data } = await api.post(`/meeting/${id}/minutes/regenerate`, { force });
      setMinutes(data.data);
      setEditing(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { code?: string; message?: string } } } };
      alert(err.response?.data?.error?.message || '재생성 중 오류');
    }
  };

  const handleToggleTranscripts = async () => {
    if (!showTranscripts && transcripts.length === 0) {
      try {
        const { data } = await api.get(`/meeting/${id}/transcripts`);
        setTranscripts(data.data);
      } catch { /* ignore */ }
    }
    setShowTranscripts((v) => !v);
  };

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Loader2 size={32} className="mx-auto animate-spin" />
        <p className="mt-2">회의록을 불러오는 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle size={40} className="mx-auto text-red-500 mb-2" />
        <p className="text-red-600 font-medium">{error}</p>
        <button onClick={() => navigate('/meeting')} className="btn-secondary mt-4">
          회의 목록으로
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto print:p-0 print:max-w-none">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4 print:hidden">
        <Link to="/meeting" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileText className="text-primary-600" size={24} />
          AI 회의록
        </h1>
        <div className="flex-1" />
        <button onClick={handlePrint} className="btn-secondary flex items-center gap-1">
          <Printer size={14} /> 인쇄 / PDF
        </button>
      </div>

      {/* 회의 정보 */}
      {meeting && (
        <div className="bg-white rounded-xl p-5 mb-4 border border-gray-200 print:border-0 print:shadow-none">
          <h2 className="text-2xl font-bold mb-2">{meeting.title}</h2>
          {meeting.description && <p className="text-gray-600 mb-3">{meeting.description}</p>}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <div>주최자: <span className="font-medium text-gray-800">{meeting.host.name}</span></div>
            {meeting.startedAt && <div>시작: {new Date(meeting.startedAt).toLocaleString('ko-KR')}</div>}
            {meeting.endedAt && <div>종료: {new Date(meeting.endedAt).toLocaleString('ko-KR')}</div>}
          </div>
        </div>
      )}

      {/* 상태 + 액션 바 */}
      {minutes && (
        <div className="bg-white rounded-xl p-4 mb-4 border border-gray-200 flex flex-wrap items-center gap-2 print:hidden">
          <span className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${STATUS_META[minutes.status].color}`}>
            {STATUS_META[minutes.status].icon}
            {STATUS_META[minutes.status].label}
          </span>
          {minutes.generatedAt && (
            <span className="text-xs text-gray-500">
              생성: {new Date(minutes.generatedAt).toLocaleString('ko-KR')}
            </span>
          )}
          {minutes.finalizedBy && minutes.finalizedAt && (
            <span className="text-xs text-gray-500">
              확정: {minutes.finalizedBy.name} · {new Date(minutes.finalizedAt).toLocaleString('ko-KR')}
            </span>
          )}
          <div className="flex-1" />

          {editing ? (
            <>
              <button onClick={() => { setEditing(false); setDraft(null); }} className="btn-secondary flex items-center gap-1" disabled={saving}>
                <X size={14} /> 취소
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1">
                <Save size={14} /> {saving ? '저장 중...' : '저장'}
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button onClick={handleEdit} className="btn-secondary flex items-center gap-1">
                  <Edit2 size={14} /> 편집
                </button>
              )}
              {canFinalize && (
                <button onClick={handleFinalize} className="btn-primary flex items-center gap-1">
                  <CheckCircle2 size={14} /> 확정
                </button>
              )}
              {canRegenerate && (
                <button onClick={handleRegenerate} className="btn-secondary flex items-center gap-1 text-amber-700 border-amber-300 hover:bg-amber-50">
                  <RefreshCw size={14} /> 재생성
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 본문 — 회의록 아직 없음 */}
      {!minutes && (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500 border border-gray-200">
          <FileText size={40} className="mx-auto mb-2 opacity-40" />
          <p>아직 회의록이 생성되지 않았습니다.</p>
          <p className="text-xs mt-1">회의가 종료되면 자동으로 AI 요약이 시작됩니다.</p>
        </div>
      )}

      {/* 본문 — 생성 중 */}
      {minutes?.status === 'generating' && (
        <div className="bg-amber-50 rounded-xl p-8 text-center border border-amber-200">
          <Loader2 size={40} className="mx-auto mb-2 text-amber-600 animate-spin" />
          <p className="text-amber-700 font-medium">AI가 발언 기록을 분석하고 있습니다...</p>
          <p className="text-xs text-amber-600 mt-1">약 10~30초 소요됩니다. 잠시만 기다려주세요.</p>
        </div>
      )}

      {/* 본문 — 실패 */}
      {minutes?.status === 'failed' && (
        <div className="bg-red-50 rounded-xl p-6 border border-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="font-medium text-red-700">회의록 생성에 실패했습니다</p>
              <p className="text-sm text-red-600 mt-1 whitespace-pre-wrap">{minutes.errorMessage || '알 수 없는 오류'}</p>
              {canRegenerate && (
                <button onClick={handleRegenerate} className="btn-secondary mt-3 flex items-center gap-1 text-red-700 border-red-300 hover:bg-red-100">
                  <RefreshCw size={14} /> 다시 시도
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 본문 — draft/final (조회 or 편집) */}
      {minutes && (minutes.status === 'draft' || minutes.status === 'final') && (
        <div className="space-y-4">
          <Section title="전체 요약">
            {editing && draft ? (
              <textarea
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                className="input-field w-full min-h-[200px] font-mono text-sm"
                maxLength={20000}
              />
            ) : (
              <div className="text-gray-800 whitespace-pre-wrap leading-relaxed">{minutes.summary || '(요약 없음)'}</div>
            )}
          </Section>

          <Section title="📌 주요 논의 주제">
            <EditableList
              values={editing && draft ? draft.topics : minutes.topics}
              editing={editing}
              onChange={(v) => draft && setDraft({ ...draft, topics: v })}
              placeholder="논의 주제"
            />
          </Section>

          <Section title="✅ 결정 사항">
            <EditableList
              values={editing && draft ? draft.decisions : minutes.decisions}
              editing={editing}
              onChange={(v) => draft && setDraft({ ...draft, decisions: v })}
              placeholder="결정된 사항"
            />
          </Section>

          <Section title="📝 액션 아이템">
            <ActionItemsList
              values={editing && draft ? draft.actionItems : minutes.actionItems}
              editing={editing}
              onChange={(v) => draft && setDraft({ ...draft, actionItems: v })}
            />
          </Section>
        </div>
      )}

      {/* 원문 발언 기록 */}
      {minutes && (
        <div className="mt-6 print:hidden">
          <button
            onClick={handleToggleTranscripts}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            {showTranscripts ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            원문 발언 기록 보기
          </button>
          {showTranscripts && (
            <div className="mt-2 bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto text-xs font-mono">
              {transcripts.length === 0 ? (
                <p className="text-gray-500">발언 기록이 없습니다.</p>
              ) : (
                transcripts.map((t) => (
                  <div key={t.id} className="mb-1">
                    <span className="text-gray-400">[{new Date(t.timestamp).toLocaleTimeString('ko-KR')}]</span>
                    {' '}
                    <span className="font-semibold text-gray-800">{t.speakerName}:</span>
                    {' '}
                    <span className="text-gray-700">{t.text}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────── 하위 컴포넌트 ───────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-200 print:border-0 print:shadow-none print:rounded-none">
      <h3 className="font-bold text-gray-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EditableList({
  values, editing, onChange, placeholder,
}: {
  values: string[];
  editing: boolean;
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  if (!editing) {
    if (values.length === 0) return <p className="text-gray-400 text-sm">(없음)</p>;
    return (
      <ul className="list-disc ml-5 space-y-1 text-gray-800">
        {values.map((v, i) => <li key={i}>{v}</li>)}
      </ul>
    );
  }
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={v}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="input-field flex-1"
            placeholder={placeholder}
            maxLength={1000}
          />
          <button
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="p-1 text-red-500 hover:bg-red-50 rounded"
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="text-sm text-primary-600 hover:text-primary-700"
      >
        + 항목 추가
      </button>
    </div>
  );
}

function ActionItemsList({
  values, editing, onChange,
}: {
  values: ActionItem[];
  editing: boolean;
  onChange: (v: ActionItem[]) => void;
}) {
  if (!editing) {
    if (values.length === 0) return <p className="text-gray-400 text-sm">(없음)</p>;
    return (
      <ul className="space-y-2">
        {values.map((a, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="bg-primary-100 text-primary-700 text-xs font-medium px-2 py-0.5 rounded">
              {a.assignee}
            </span>
            <div className="flex-1">
              <div className="text-gray-800">{a.task}</div>
              {a.dueDate && <div className="text-xs text-gray-500 mt-0.5">마감: {a.dueDate}</div>}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-3">
      {values.map((a, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={a.assignee}
              onChange={(e) => {
                const next = [...values];
                next[i] = { ...a, assignee: e.target.value };
                onChange(next);
              }}
              placeholder="담당자"
              className="input-field flex-1"
              maxLength={100}
            />
            <input
              type="text"
              value={a.dueDate || ''}
              onChange={(e) => {
                const next = [...values];
                next[i] = { ...a, dueDate: e.target.value || undefined };
                onChange(next);
              }}
              placeholder="마감일 (YYYY-MM-DD)"
              className="input-field w-44"
              maxLength={20}
            />
            <button
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="p-1 text-red-500 hover:bg-red-50 rounded"
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <input
            type="text"
            value={a.task}
            onChange={(e) => {
              const next = [...values];
              next[i] = { ...a, task: e.target.value };
              onChange(next);
            }}
            placeholder="할 일"
            className="input-field w-full"
            maxLength={500}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, { assignee: '', task: '' }])}
        className="text-sm text-primary-600 hover:text-primary-700"
      >
        + 액션 아이템 추가
      </button>
    </div>
  );
}
