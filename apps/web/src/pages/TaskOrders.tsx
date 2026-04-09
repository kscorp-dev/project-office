import { useEffect, useState } from 'react';
import {
  ClipboardList, Plus, Search, X, ChevronLeft, CheckSquare, MessageCircle,
  AlertTriangle, Clock, ArrowRight, Send,
} from 'lucide-react';
import api from '../services/api';
import { useAuthStore } from '../store/auth';

interface TaskOrder {
  id: string;
  taskNumber: string;
  title: string;
  status: string;
  priority: string;
  category?: string;
  dueDate?: string;
  createdAt: string;
  creator: { id: string; name: string; position?: string };
  client?: { id: string; companyName: string };
  assignees: { userId: string; role: string; user: { id: string; name: string } }[];
  _count: { comments: number; checklist: number; designFiles: number };
  progress: number;
}

interface TaskDetail {
  id: string;
  taskNumber: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category?: string;
  instructionDate?: string;
  dueDate?: string;
  completedAt?: string;
  additionalNote?: string;
  creator: { id: string; name: string; position?: string; department?: { name: string } };
  client?: any;
  assignees: { userId: string; role: string; status: string; user: { id: string; name: string; position?: string } }[];
  items: { id: string; itemName: string; description?: string; quantity: number; unit?: string; unitPrice?: number; totalPrice?: number; note?: string }[];
  billing?: any;
  checklist: { id: string; content: string; isCompleted: boolean; sortOrder: number }[];
  comments: { id: string; content: string; createdAt: string; user: { id: string; name: string } }[];
  statusHistory: { id: string; fromStatus?: string; toStatus: string; changedAt: string; comment?: string; user: { id: string; name: string } }[];
  designFiles: { id: string; fileName: string; fileSize: bigint; fileType: string; version: number; isApproved: boolean; createdAt: string; uploader: { id: string; name: string } }[];
}

interface Stats { sent: number; received: number; inProgress: number; overdue: number }

const statusLabel: Record<string, { text: string; color: string }> = {
  draft: { text: '임시저장', color: 'bg-gray-100 text-gray-700' },
  instructed: { text: '작업지시', color: 'bg-primary-100 text-primary-700' },
  in_progress: { text: '진행중', color: 'bg-yellow-100 text-yellow-700' },
  partial_complete: { text: '부분완료', color: 'bg-orange-100 text-orange-700' },
  work_complete: { text: '작업완료', color: 'bg-green-100 text-green-700' },
  billing_complete: { text: '대금청구완료', color: 'bg-purple-100 text-purple-700' },
  final_complete: { text: '최종완료', color: 'bg-emerald-100 text-emerald-700' },
  discarded: { text: '폐기', color: 'bg-red-100 text-red-700' },
};

const priorityLabel: Record<string, { text: string; color: string }> = {
  low: { text: '낮음', color: 'text-gray-400' },
  normal: { text: '보통', color: 'text-primary-500' },
  high: { text: '높음', color: 'text-orange-500' },
  urgent: { text: '긴급', color: 'text-red-600' },
};

const roleLabel: Record<string, string> = {
  main: '주담당', support: '보조', reviewer: '검수자', designer: '디자이너',
};

const STATUS_TRANSITIONS: Record<string, { label: string; next: string }[]> = {
  draft: [{ label: '작업지시', next: 'instructed' }],
  instructed: [{ label: '진행 시작', next: 'in_progress' }],
  in_progress: [{ label: '부분완료', next: 'partial_complete' }, { label: '작업완료', next: 'work_complete' }],
  partial_complete: [{ label: '작업완료', next: 'work_complete' }],
  work_complete: [{ label: '대금청구완료', next: 'billing_complete' }, { label: '최종완료', next: 'final_complete' }],
  billing_complete: [{ label: '최종완료', next: 'final_complete' }],
};

export default function TaskOrdersPage() {
  const { user } = useAuthStore();
  const [tasks, setTasks] = useState<TaskOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [box, setBox] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });

  useEffect(() => { fetchStats(); }, []);
  useEffect(() => { fetchTasks(); }, [box, statusFilter, search, pagination.page]);

  const fetchStats = async () => {
    try {
      const res = await api.get('/task-orders/stats/summary');
      setStats(res.data.data);
    } catch (err) { console.error(err); }
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pagination.page.toString(), limit: '20', box });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const res = await api.get(`/task-orders?${params}`);
      setTasks(res.data.data);
      setPagination(res.data.meta);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchDetail = async (id: string) => {
    try {
      const res = await api.get(`/task-orders/${id}`);
      setSelectedTask(res.data.data);
    } catch (err) { console.error(err); }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const itemsRaw = form.get('items') as string;
      const checklistRaw = form.get('checklist') as string;
      await api.post('/task-orders', {
        title: form.get('title'),
        description: form.get('description') || undefined,
        priority: form.get('priority') || 'normal',
        category: form.get('category') || undefined,
        dueDate: form.get('dueDate') || undefined,
        instructionDate: new Date().toISOString(),
        items: itemsRaw ? itemsRaw.split('\n').filter(Boolean).map(line => {
          const [itemName, qty, unit] = line.split(',').map(s => s.trim());
          return { itemName, quantity: parseFloat(qty) || 1, unit: unit || 'EA' };
        }) : undefined,
        checklist: checklistRaw ? checklistRaw.split('\n').filter(Boolean) : undefined,
      });
      setShowCreateModal(false);
      fetchTasks();
      fetchStats();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '작성 중 오류가 발생했습니다');
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const comment = newStatus === 'discarded' ? prompt('폐기 사유를 입력하세요:') : undefined;
    if (newStatus === 'discarded' && !comment) return;
    try {
      await api.post(`/task-orders/${taskId}/status`, { status: newStatus, comment });
      fetchDetail(taskId);
      fetchTasks();
      fetchStats();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '상태 변경 중 오류가 발생했습니다');
    }
  };

  const handleAddComment = async () => {
    if (!selectedTask || !newComment.trim()) return;
    try {
      await api.post(`/task-orders/${selectedTask.id}/comments`, { content: newComment });
      setNewComment('');
      fetchDetail(selectedTask.id);
    } catch (err: any) { alert(err.response?.data?.error?.message || '오류'); }
  };

  const handleChecklistToggle = async (checkId: string) => {
    if (!selectedTask) return;
    try {
      await api.patch(`/task-orders/${selectedTask.id}/checklist/${checkId}`);
      fetchDetail(selectedTask.id);
    } catch (err: any) { alert(err.response?.data?.error?.message || '오류'); }
  };

  const getDDay = (dateStr?: string) => {
    if (!dateStr) return null;
    const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
    if (diff < 0) return { text: `D+${Math.abs(diff)}`, color: 'text-red-600 font-bold' };
    if (diff === 0) return { text: 'D-Day', color: 'text-orange-600 font-bold' };
    if (diff <= 3) return { text: `D-${diff}`, color: 'text-orange-500' };
    return { text: `D-${diff}`, color: 'text-gray-500' };
  };

  const formatDate = (dt: string) => new Date(dt).toLocaleDateString('ko-KR');
  const formatDateTime = (dt: string) => new Date(dt).toLocaleString('ko-KR');

  // Detail View
  if (selectedTask) {
    const transitions = STATUS_TRANSITIONS[selectedTask.status] || [];
    const checkDone = selectedTask.checklist.filter(c => c.isCompleted).length;
    const checkTotal = selectedTask.checklist.length;

    return (
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => setSelectedTask(null)} className="flex items-center gap-1 text-gray-500 hover:text-gray-700 mb-4">
          <ChevronLeft size={16} /> 목록으로
        </button>

        <div className="card mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-400 mb-1">{selectedTask.taskNumber}</p>
              <h2 className="text-xl font-bold">{selectedTask.title}</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${statusLabel[selectedTask.status]?.color}`}>
                  {statusLabel[selectedTask.status]?.text}
                </span>
                <span className={`text-sm ${priorityLabel[selectedTask.priority]?.color}`}>
                  {priorityLabel[selectedTask.priority]?.text}
                </span>
                {selectedTask.dueDate && (() => {
                  const dd = getDDay(selectedTask.dueDate);
                  return dd ? <span className={`text-sm ${dd.color}`}>{dd.text}</span> : null;
                })()}
              </div>
            </div>
            <div className="flex gap-2">
              {transitions.map(t => (
                <button key={t.next} onClick={() => handleStatusChange(selectedTask.id, t.next)}
                  className="btn-primary text-sm flex items-center gap-1">
                  <ArrowRight size={14} /> {t.label}
                </button>
              ))}
              {['draft', 'instructed'].includes(selectedTask.status) && (
                <button onClick={() => handleStatusChange(selectedTask.id, 'discarded')}
                  className="btn-secondary text-red-600 text-sm">폐기</button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><span className="text-gray-500">작성자:</span> {selectedTask.creator.name}</div>
            <div><span className="text-gray-500">작성일:</span> {formatDate(selectedTask.instructionDate || selectedTask.statusHistory[0]?.changedAt || '')}</div>
            {selectedTask.dueDate && <div><span className="text-gray-500">마감일:</span> {formatDate(selectedTask.dueDate)}</div>}
            {selectedTask.client && <div><span className="text-gray-500">거래처:</span> {selectedTask.client.companyName}</div>}
          </div>

          {selectedTask.description && (
            <div className="border-t pt-4 mb-4">
              <h4 className="font-semibold text-sm mb-2">상세 내용</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedTask.description}</p>
            </div>
          )}

          {/* 담당자 */}
          <div className="border-t pt-4 mb-4">
            <h4 className="font-semibold text-sm mb-2">담당자</h4>
            <div className="flex flex-wrap gap-2">
              {selectedTask.assignees.map(a => (
                <span key={a.userId} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                  {a.user.name} <span className="text-gray-400">({roleLabel[a.role] || a.role})</span>
                </span>
              ))}
            </div>
          </div>

          {/* 작업 항목 */}
          {selectedTask.items.length > 0 && (
            <div className="border-t pt-4 mb-4">
              <h4 className="font-semibold text-sm mb-2">작업 항목</h4>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">품명</th><th className="pb-2">수량</th><th className="pb-2">단위</th><th className="pb-2">단가</th><th className="pb-2">금액</th>
                </tr></thead>
                <tbody>
                  {selectedTask.items.map(item => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-2">{item.itemName}</td>
                      <td className="py-2">{item.quantity}</td>
                      <td className="py-2">{item.unit || '-'}</td>
                      <td className="py-2">{item.unitPrice?.toLocaleString() || '-'}</td>
                      <td className="py-2">{item.totalPrice?.toLocaleString() || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 체크리스트 */}
          {checkTotal > 0 && (
            <div className="border-t pt-4 mb-4">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                <CheckSquare size={16} /> 체크리스트 ({checkDone}/{checkTotal}) - {checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0}%
              </h4>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                <div className="bg-primary-600 h-2 rounded-full" style={{ width: `${checkTotal > 0 ? (checkDone / checkTotal) * 100 : 0}%` }} />
              </div>
              <div className="space-y-2">
                {selectedTask.checklist.map(c => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-primary-50/50 p-1 rounded">
                    <input type="checkbox" checked={c.isCompleted} onChange={() => handleChecklistToggle(c.id)} className="rounded" />
                    <span className={c.isCompleted ? 'line-through text-gray-400' : ''}>{c.content}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 진행 이력 */}
          <div className="border-t pt-4 mb-4">
            <h4 className="font-semibold text-sm mb-2">진행 이력</h4>
            <div className="space-y-2">
              {selectedTask.statusHistory.map(h => (
                <div key={h.id} className="flex items-start gap-3 text-sm">
                  <span className="text-gray-400 whitespace-nowrap">{formatDateTime(h.changedAt)}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${statusLabel[h.toStatus]?.color || 'bg-gray-100'}`}>
                    {statusLabel[h.toStatus]?.text || h.toStatus}
                  </span>
                  <span className="text-gray-600">{h.user.name}</span>
                  {h.comment && <span className="text-gray-500">- {h.comment}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* 코멘트 */}
          <div className="border-t pt-4">
            <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <MessageCircle size={16} /> 코멘트 ({selectedTask.comments.length})
            </h4>
            <div className="space-y-3 mb-4">
              {selectedTask.comments.map(c => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{c.user.name}</span>
                  <span className="text-gray-400 ml-2">{formatDateTime(c.createdAt)}</span>
                  <p className="text-gray-700 mt-1">{c.content}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input type="text" value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                placeholder="코멘트 입력..." className="input-field flex-1" />
              <button onClick={handleAddComment} className="btn-primary"><Send size={16} /></button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList size={24} /> 작업지시서
        </h1>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> 작업지시서 작성
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: '보낸 지시서', value: stats.sent, color: 'text-primary-600' },
            { label: '받은 지시서', value: stats.received, color: 'text-green-600' },
            { label: '진행중', value: stats.inProgress, color: 'text-yellow-600' },
            { label: '지연', value: stats.overdue, color: 'text-red-600' },
          ].map(s => (
            <div key={s.label} className="card text-center py-4">
              <p className="text-gray-500 text-sm">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-1 bg-primary-50/50 p-1.5 rounded-2xl">
          {[
            { key: 'all', label: '전체' },
            { key: 'sent', label: '보낸 지시서' },
            { key: 'received', label: '받은 지시서' },
          ].map(b => (
            <button key={b.key} onClick={() => setBox(b.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${box === b.key ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500'}`}>
              {b.label}
            </button>
          ))}
        </div>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-field w-40">
          <option value="">상태 전체</option>
          {Object.entries(statusLabel).map(([k, v]) => (
            <option key={k} value={k}>{v.text}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="작업명칭 또는 지시서번호 검색..." className="input-field pl-9 w-full" />
        </div>
      </div>

      {/* Task List */}
      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-3 font-medium">지시서번호</th>
              <th className="pb-3 font-medium">작업명칭</th>
              <th className="pb-3 font-medium">상태</th>
              <th className="pb-3 font-medium">우선순위</th>
              <th className="pb-3 font-medium">담당자</th>
              <th className="pb-3 font-medium">마감</th>
              <th className="pb-3 font-medium">진행률</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">로딩중...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-gray-400">작업지시서가 없습니다</td></tr>
            ) : tasks.map(task => {
              const dd = getDDay(task.dueDate);
              return (
                <tr key={task.id} onClick={() => fetchDetail(task.id)}
                  className="border-b last:border-0 hover:bg-primary-50/50 cursor-pointer">
                  <td className="py-3 font-mono text-xs text-gray-500">{task.taskNumber}</td>
                  <td className="py-3">
                    <div className="font-medium">{task.title}</div>
                    {task.client && <div className="text-xs text-gray-400">{task.client.companyName}</div>}
                  </td>
                  <td className="py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusLabel[task.status]?.color}`}>
                      {statusLabel[task.status]?.text}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={priorityLabel[task.priority]?.color}>
                      {task.priority === 'urgent' && <AlertTriangle size={14} className="inline mr-1" />}
                      {priorityLabel[task.priority]?.text}
                    </span>
                  </td>
                  <td className="py-3 text-gray-600">
                    {task.assignees.map(a => a.user.name).join(', ') || '-'}
                  </td>
                  <td className="py-3">
                    {task.dueDate ? (
                      <div>
                        <div className="text-gray-600">{formatDate(task.dueDate)}</div>
                        {dd && <div className={`text-xs ${dd.color}`}>{dd.text}</div>}
                      </div>
                    ) : '-'}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-primary-600 h-1.5 rounded-full" style={{ width: `${task.progress}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{task.progress}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {pagination.totalPages > 1 && (
          <div className="flex justify-center gap-1 mt-4 pt-4 border-t">
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPagination(prev => ({ ...prev, page: p }))}
                className={`px-3 py-1 rounded text-sm ${pagination.page === p ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">작업지시서 작성</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">작업명칭 *</label>
                <input type="text" name="title" className="input-field" required maxLength={200} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상세 내용</label>
                <textarea name="description" rows={4} className="input-field" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">우선순위</label>
                  <select name="priority" className="input-field">
                    <option value="low">낮음</option>
                    <option value="normal" selected>보통</option>
                    <option value="high">높음</option>
                    <option value="urgent">긴급</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                  <input type="text" name="category" className="input-field" placeholder="예: 디자인, 생산, 시공" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">마감일</label>
                <input type="date" name="dueDate" className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">작업 항목 (줄바꿈 구분: 품명,수량,단위)</label>
                <textarea name="items" rows={3} className="input-field font-mono text-sm" placeholder="디자인 시안 제작,1,건&#10;출력물 제작,10,장" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">체크리스트 (줄바꿈 구분)</label>
                <textarea name="checklist" rows={3} className="input-field text-sm" placeholder="디자인 검수 완료&#10;출력 테스트&#10;포장 확인" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">작성</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
