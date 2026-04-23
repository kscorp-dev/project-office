/**
 * 관리자 카메라 권한 관리 페이지 (v0.19.0 — #7 UI)
 *
 * 경로: /admin/cameras/permissions
 *
 * 기능:
 *   - 카메라 선택
 *   - 공개/비공개 토글
 *   - 사용자/부서/역할별 권한 부여 (view/control)
 *   - ONVIF PTZ 접속 테스트
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Video, Plus, Trash2, CheckCircle2, AlertCircle, X,
  Zap, Loader2, Unlock, Lock,
} from 'lucide-react';
import { api } from '../../services/api';

interface Camera {
  id: string;
  name: string;
  location?: string;
  isActive: boolean;
  isPtz: boolean;
  isPublic: boolean;
  ptzAdapter?: string;
  groupId?: string;
  group?: { id: string; name: string };
}

interface Permission {
  id: string;
  cameraId: string;
  subjectType: 'user' | 'department' | 'role';
  subjectId: string;
  level: 'view' | 'control';
  createdAt: string;
}

interface User { id: string; name: string; employeeId: string }
interface Department { id: string; name: string; code: string }

const ROLE_OPTIONS = [
  { value: 'user', label: '일반 사용자' },
  { value: 'dept_admin', label: '부서 관리자' },
  { value: 'admin', label: '관리자' },
  { value: 'super_admin', label: '슈퍼 관리자' },
];

export default function CameraPermissionsPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selected, setSelected] = useState<Camera | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.get('/cctv/cameras')
      .then(({ data }) => {
        setCameras(data.data || []);
        if (data.data?.length) setSelected(data.data[0]);
      })
      .catch((e: unknown) => setToast({ type: 'error', message: (e as Error).message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.get(`/cctv/cameras/${selected.id}/permissions`)
      .then(({ data }) => setPermissions(data.data || []))
      .catch(() => setPermissions([]));
  }, [selected]);

  const togglePublic = async () => {
    if (!selected) return;
    try {
      const { data } = await api.patch(`/cctv/cameras/${selected.id}`, {
        isPublic: !selected.isPublic,
      });
      setSelected({ ...selected, isPublic: data.data.isPublic });
      setCameras(cameras.map((c) => (c.id === selected.id ? { ...c, isPublic: data.data.isPublic } : c)));
    } catch (e: unknown) {
      setToast({ type: 'error', message: (e as Error).message });
    }
  };

  const deletePerm = async (permId: string) => {
    if (!selected) return;
    if (!confirm('이 권한을 삭제할까요?')) return;
    try {
      await api.delete(`/cctv/cameras/${selected.id}/permissions/${permId}`);
      setPermissions(permissions.filter((p) => p.id !== permId));
    } catch (e: unknown) {
      setToast({ type: 'error', message: (e as Error).message });
    }
  };

  const testPtz = async () => {
    if (!selected) return;
    setTesting(true);
    try {
      const { data } = await api.post(`/cctv/cameras/${selected.id}/ptz/test`);
      setToast({ type: 'success', message: `PTZ 접속: ${data.data.message}` });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      setToast({ type: 'error', message: err.response?.data?.error?.message || '접속 실패' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-gray-500"><Loader2 size={24} className="mx-auto animate-spin" /></div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Video className="text-primary-600" />
          카메라 권한 관리
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 카메라 목록 */}
        <div className="md:col-span-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold text-sm bg-gray-50">카메라 목록</div>
          <div className="max-h-[600px] overflow-y-auto">
            {cameras.length === 0 ? (
              <div className="p-6 text-sm text-gray-500 text-center">카메라가 없습니다</div>
            ) : (
              cameras.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-gray-50 ${
                    selected?.id === c.id ? 'bg-primary-50 border-l-4 border-l-primary-500' : ''
                  }`}
                >
                  <div className="font-medium text-sm flex items-center gap-2">
                    {c.name}
                    {c.isPtz && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">PTZ</span>}
                    {c.isPublic && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">공개</span>}
                  </div>
                  {c.location && <div className="text-xs text-gray-500 mt-0.5">{c.location}</div>}
                  {c.group && <div className="text-xs text-gray-400 mt-0.5">{c.group.name}</div>}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 상세 + 권한 */}
        <div className="md:col-span-2 space-y-4">
          {selected && (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-bold text-lg mb-1">{selected.name}</h2>
                {selected.location && <div className="text-sm text-gray-500 mb-3">{selected.location}</div>}

                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={togglePublic}
                    className={`text-sm flex items-center gap-1 px-3 py-1.5 rounded-lg ${
                      selected.isPublic
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {selected.isPublic ? <><Unlock size={14} /> 공개 (모두 조회 가능)</> : <><Lock size={14} /> 비공개</>}
                  </button>
                  {selected.isPtz && (
                    <button
                      onClick={testPtz}
                      disabled={testing}
                      className="text-sm flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200"
                    >
                      {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                      PTZ 접속 테스트
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                  <h3 className="font-semibold text-sm">권한 목록 ({permissions.length})</h3>
                  <button onClick={() => setShowAdd(true)} className="btn-primary text-xs flex items-center gap-1">
                    <Plus size={12} /> 권한 추가
                  </button>
                </div>
                {permissions.length === 0 ? (
                  <div className="p-6 text-sm text-gray-500 text-center">
                    아직 권한이 없습니다. {selected.isPublic ? '(공개 카메라라 누구나 조회 가능)' : '(관리자만 접근 가능)'}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-3">대상 유형</th>
                        <th className="text-left p-3">대상 ID/이름</th>
                        <th className="text-left p-3">권한</th>
                        <th className="text-right p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {permissions.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="p-3">
                            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                              {p.subjectType === 'user' ? '사용자' : p.subjectType === 'department' ? '부서' : '역할'}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-xs">{p.subjectId}</td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              p.level === 'control' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                              {p.level === 'control' ? '조회 + PTZ 제어' : '조회만'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <button onClick={() => deletePerm(p.id)} className="text-red-500 hover:bg-red-50 p-1 rounded">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {!selected && (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
              카메라를 선택하세요
            </div>
          )}
        </div>
      </div>

      {showAdd && selected && (
        <AddPermissionModal
          camera={selected}
          onClose={() => setShowAdd(false)}
          onAdded={(p) => {
            setPermissions([...permissions, p]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddPermissionModal({
  camera, onClose, onAdded,
}: {
  camera: Camera;
  onClose: () => void;
  onAdded: (p: Permission) => void;
}) {
  const [subjectType, setSubjectType] = useState<'user' | 'department' | 'role'>('user');
  const [subjectId, setSubjectId] = useState('');
  const [level, setLevel] = useState<'view' | 'control'>('view');
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (subjectType === 'user' && users.length === 0) {
      api.get('/admin/users?limit=500').then(({ data }) => setUsers(data.data || [])).catch(() => {});
    }
    if (subjectType === 'department' && departments.length === 0) {
      api.get('/departments').then(({ data }) => setDepartments(data.data || [])).catch(() => {});
    }
  }, [subjectType, users.length, departments.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId) { alert('대상을 선택하세요'); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/cctv/cameras/${camera.id}/permissions`, {
        subjectType, subjectId, level,
      });
      onAdded(data.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      alert(err.response?.data?.error?.message || '실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold">권한 추가 - {camera.name}</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">대상 유형</label>
            <select
              value={subjectType}
              onChange={(e) => { setSubjectType(e.target.value as typeof subjectType); setSubjectId(''); }}
              className="input-field w-full"
            >
              <option value="user">특정 사용자</option>
              <option value="department">부서</option>
              <option value="role">역할</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">대상</label>
            {subjectType === 'user' && (
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="input-field w-full">
                <option value="">(선택)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.employeeId})</option>
                ))}
              </select>
            )}
            {subjectType === 'department' && (
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="input-field w-full">
                <option value="">(선택)</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
            )}
            {subjectType === 'role' && (
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="input-field w-full">
                <option value="">(선택)</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">권한</label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={level === 'view'} onChange={() => setLevel('view')} />
                <span className="text-sm">조회만 (실시간 시청 + 녹화 재생)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" checked={level === 'control'} onChange={() => setLevel('control')} />
                <span className="text-sm">조회 + PTZ 제어 (카메라 회전/줌)</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">취소</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? '저장 중...' : '권한 부여'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
