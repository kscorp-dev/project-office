import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';
import {
  FileCheck, Plus, Clock, CheckCircle, XCircle, Send,
  ChevronRight, Eye, AlertCircle,
} from 'lucide-react';

interface ApprovalDoc {
  id: string;
  docNumber: string;
  title: string;
  status: string;
  urgency: string;
  createdAt: string;
  submittedAt?: string;
  template: { name: string; category: string };
  drafter: { id: string; name: string; department?: { name: string } };
  lines: { step: number; status: string; approver: { name: string } }[];
}

const BOX_TABS = [
  { key: 'pending', label: '결재함', icon: Clock },
  { key: 'drafts', label: '기안함', icon: Send },
  { key: 'approved', label: '완료함', icon: CheckCircle },
  { key: 'temp', label: '임시저장', icon: AlertCircle },
  { key: 'references', label: '참조함', icon: Eye },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '임시저장', color: 'bg-gray-100 text-gray-600' },
  pending: { label: '결재중', color: 'bg-yellow-100 text-yellow-700' },
  approved: { label: '승인', color: 'bg-green-100 text-green-700' },
  rejected: { label: '반려', color: 'bg-red-100 text-red-700' },
  withdrawn: { label: '회수', color: 'bg-gray-100 text-gray-500' },
};

export default function ApprovalPage() {
  const { user } = useAuthStore();
  const [activeBox, setActiveBox] = useState('pending');
  const [documents, setDocuments] = useState<ApprovalDoc[]>([]);
  const [, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetchDocuments();
    fetchPendingCount();
  }, [activeBox]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/approvals/documents', { params: { box: activeBox } });
      setDocuments(data.data || []);
      setMeta(data.meta || { total: 0, page: 1, totalPages: 1 });
    } catch {}
    setLoading(false);
  };

  const fetchPendingCount = async () => {
    try {
      const { data } = await api.get('/approvals/count');
      setPendingCount(data.data.pending || 0);
    } catch {}
  };

  const handleAction = async (docId: string, action: string, comment = '') => {
    try {
      await api.post(`/approvals/documents/${docId}/${action}`, { comment });
      fetchDocuments();
      fetchPendingCount();
      setSelectedDoc(null);
    } catch {}
  };

  const openDetail = async (docId: string) => {
    try {
      const { data } = await api.get(`/approvals/documents/${docId}`);
      setSelectedDoc(data.data);
    } catch {}
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">전자결재</h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> 새 결재
        </button>
      </div>

      {/* Box Tabs */}
      <div className="flex gap-1 mb-6 bg-primary-50/50 p-1.5 rounded-2xl w-fit">
        {BOX_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveBox(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeBox === key ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={16} />
            {label}
            {key === 'pending' && pendingCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Document List */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12 text-gray-400">로딩 중...</div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileCheck size={48} className="mx-auto mb-2 opacity-50" />
            <p>문서가 없습니다</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-sm text-gray-500">
                <th className="text-left py-3 px-2">문서번호</th>
                <th className="text-left py-3 px-2">양식</th>
                <th className="text-left py-3 px-2">제목</th>
                <th className="text-left py-3 px-2">기안자</th>
                <th className="text-left py-3 px-2">결재선</th>
                <th className="text-left py-3 px-2">상태</th>
                <th className="text-left py-3 px-2">일시</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => openDetail(doc.id)}
                  className="border-b hover:bg-primary-50/50 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-2 text-sm text-gray-500 font-mono">{doc.docNumber}</td>
                  <td className="py-3 px-2 text-sm">{doc.template.name}</td>
                  <td className="py-3 px-2 font-medium text-gray-900">
                    {doc.urgency === 'urgent' && <span className="text-red-500 mr-1">[긴급]</span>}
                    {doc.title}
                  </td>
                  <td className="py-3 px-2 text-sm text-gray-600">{doc.drafter.name}</td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-1">
                      {doc.lines.map((line, i) => (
                        <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${
                          line.status === 'approved' ? 'bg-green-100 text-green-600' :
                          line.status === 'rejected' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {line.approver.name}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${STATUS_MAP[doc.status]?.color || ''}`}>
                      {STATUS_MAP[doc.status]?.label || doc.status}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-sm text-gray-400">
                    {new Date(doc.submittedAt || doc.createdAt).toLocaleDateString('ko-KR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Modal */}
      {selectedDoc && (
        <DocDetailModal
          doc={selectedDoc}
          currentUserId={user?.id || ''}
          onClose={() => setSelectedDoc(null)}
          onApprove={(id) => handleAction(id, 'approve')}
          onReject={(id, comment) => handleAction(id, 'reject', comment)}
          onWithdraw={(id) => handleAction(id, 'withdraw')}
        />
      )}

      {/* Create Modal */}
      {showCreate && (
        <CreateDocModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchDocuments(); }}
        />
      )}
    </div>
  );
}

function DocDetailModal({ doc, currentUserId, onClose, onApprove, onReject, onWithdraw }: {
  doc: any;
  currentUserId: string;
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string, comment: string) => void;
  onWithdraw: (id: string) => void;
}) {
  const [rejectComment, setRejectComment] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const isMyTurn = doc.status === 'pending' && doc.lines.some(
    (l: any) => l.step === doc.currentStep && l.status === 'pending' && l.approver.id === currentUserId
  );
  const isMyDraft = doc.drafterId === currentUserId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-auto m-4" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">{doc.docNumber}</p>
              <h2 className="text-xl font-bold text-gray-900 mt-1">{doc.title}</h2>
            </div>
            <span className={`text-sm px-3 py-1 rounded-full ${STATUS_MAP[doc.status]?.color || ''}`}>
              {STATUS_MAP[doc.status]?.label}
            </span>
          </div>
          <div className="flex gap-4 mt-3 text-sm text-gray-500">
            <span>양식: {doc.template.name}</span>
            <span>기안자: {doc.drafter.name}</span>
            <span>{doc.drafter.department?.name}</span>
          </div>
        </div>

        <div className="p-6">
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: doc.content }} />
        </div>

        {/* 결재선 */}
        <div className="px-6 pb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">결재선</h3>
          <div className="flex items-center gap-2">
            {doc.lines.map((line: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`text-center px-3 py-2 rounded-2xl border ${
                  line.status === 'approved' ? 'border-green-300 bg-green-50' :
                  line.status === 'rejected' ? 'border-red-300 bg-red-50' :
                  line.step === doc.currentStep ? 'border-primary-300 bg-primary-50' :
                  'border-gray-200 bg-gray-50'
                }`}>
                  <p className="text-sm font-medium">{line.approver.name}</p>
                  <p className="text-xs text-gray-400">{line.approver.position}</p>
                  {line.status === 'approved' && <CheckCircle size={14} className="text-green-500 mx-auto mt-1" />}
                  {line.status === 'rejected' && <XCircle size={14} className="text-red-500 mx-auto mt-1" />}
                </div>
                {i < doc.lines.length - 1 && <ChevronRight size={16} className="text-gray-300" />}
              </div>
            ))}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="p-6 border-t flex justify-end gap-3">
          {isMyTurn && !showRejectInput && (
            <>
              <button onClick={() => setShowRejectInput(true)} className="px-4 py-2 bg-red-50 text-red-600 rounded-2xl hover:bg-red-100">반려</button>
              <button onClick={() => onApprove(doc.id)} className="btn-primary">승인</button>
            </>
          )}
          {showRejectInput && (
            <div className="flex items-center gap-2 w-full">
              <input
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="반려 사유를 입력하세요"
                className="input-field flex-1"
                autoFocus
              />
              <button onClick={() => setShowRejectInput(false)} className="btn-secondary">취소</button>
              <button onClick={() => onReject(doc.id, rejectComment)} className="px-4 py-2 bg-red-600 text-white rounded-2xl" disabled={!rejectComment}>반려 확인</button>
            </div>
          )}
          {isMyDraft && doc.status === 'pending' && (
            <button onClick={() => onWithdraw(doc.id)} className="btn-secondary">회수</button>
          )}
          <button onClick={onClose} className="btn-secondary">닫기</button>
        </div>
      </div>
    </div>
  );
}

function CreateDocModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({
    templateId: '', title: '', content: '', urgency: 'normal',
    approverIds: [] as string[], referenceIds: [] as string[],
  });

  useEffect(() => {
    api.get('/approvals/templates').then(({ data }) => setTemplates(data.data || []));
    api.get('/users', { params: { limit: 100 } }).then(({ data }) => setUsers(data.data || []));
  }, []);

  const handleSubmit = async (submit: boolean) => {
    try {
      await api.post('/approvals/documents', { ...form, submit });
      onCreated();
    } catch {}
  };

  const toggleApprover = (userId: string) => {
    setForm(f => ({
      ...f,
      approverIds: f.approverIds.includes(userId)
        ? f.approverIds.filter(id => id !== userId)
        : [...f.approverIds, userId],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-auto m-4" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">새 결재 문서</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">결재 양식 *</label>
              <select value={form.templateId} onChange={e => setForm({ ...form, templateId: e.target.value })} className="input-field">
                <option value="">선택하세요</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">긴급도</label>
              <select value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })} className="input-field">
                <option value="normal">일반</option>
                <option value="urgent">긴급</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">제목 *</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="input-field" placeholder="결재 제목" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">내용 *</label>
            <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} className="input-field h-32" placeholder="결재 내용을 입력하세요" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              결재선 * <span className="text-xs text-gray-400">(클릭 순서대로 결재 진행)</span>
            </label>
            <div className="flex flex-wrap gap-2 p-3 border rounded-2xl min-h-[40px]">
              {form.approverIds.length === 0 && <span className="text-sm text-gray-400">결재자를 선택하세요</span>}
              {form.approverIds.map((id, i) => {
                const u = users.find(u => u.id === id);
                return (
                  <span key={id} className="flex items-center gap-1 bg-primary-50 text-primary-700 px-2 py-1 rounded text-sm">
                    {i + 1}. {u?.name}
                    <button onClick={() => toggleApprover(id)} className="text-primary-400 hover:text-red-500">&times;</button>
                  </span>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {users.filter(u => !form.approverIds.includes(u.id)).map(u => (
                <button key={u.id} onClick={() => toggleApprover(u.id)} className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">
                  {u.name} {u.department?.name && `(${u.department.name})`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">취소</button>
          <button onClick={() => handleSubmit(false)} className="btn-secondary" disabled={!form.templateId || !form.title}>임시저장</button>
          <button onClick={() => handleSubmit(true)} className="btn-primary" disabled={!form.templateId || !form.title || !form.content || form.approverIds.length === 0}>
            상신
          </button>
        </div>
      </div>
    </div>
  );
}
