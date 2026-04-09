import { useEffect, useState } from 'react';
import {
  Shield, Users, Settings, ScrollText, ToggleLeft, ToggleRight,
  Search, RefreshCw, ChevronLeft, ChevronRight, Edit2, Check, X,
  UserCheck, UserX, LogIn, FileCheck,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/auth';

/* ─────────────────────────── Types ─────────────────────────── */

interface Module {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  isEnabled: boolean;
  order: number;
}

interface AdminUser {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  position?: string;
  department?: { id: string; name: string };
  lastLoginAt?: string;
  createdAt: string;
}

interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description?: string;
  category?: string;
}

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId: string;
  user: { id: string; name: string };
  ipAddress?: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  todayLogins: number;
  pendingApprovals: number;
}

type TabKey = 'modules' | 'users' | 'settings' | 'logs';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'modules',  label: '모듈관리',   icon: ToggleLeft },
  { key: 'users',    label: '사용자관리',  icon: Users },
  { key: 'settings', label: '시스템설정',  icon: Settings },
  { key: 'logs',     label: '감사로그',    icon: ScrollText },
];

const ROLE_MAP: Record<string, { label: string; color: string }> = {
  super_admin: { label: '최고관리자', color: 'bg-red-100 text-red-700' },
  admin:       { label: '관리자',     color: 'bg-orange-100 text-orange-700' },
  dept_admin:  { label: '부서관리자', color: 'bg-yellow-100 text-yellow-700' },
  user:        { label: '일반사용자', color: 'bg-gray-100 text-gray-600' },
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active:    { label: '활성',   color: 'bg-green-100 text-green-700' },
  inactive:  { label: '비활성', color: 'bg-gray-100 text-gray-500' },
  suspended: { label: '정지',   color: 'bg-red-100 text-red-600' },
  pending:   { label: '대기중', color: 'bg-yellow-100 text-yellow-700' },
};

/* ─────────────────────────── Component ─────────────────────────── */

export default function AdminConsolePage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabKey>('modules');
  const [stats, setStats] = useState<AdminStats>({ totalUsers: 0, activeUsers: 0, todayLogins: 0, pendingApprovals: 0 });

  // Modules
  const [modules, setModules] = useState<Module[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);

  // Users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersMeta, setUsersMeta] = useState({ total: 0, page: 1, totalPages: 1 });

  // Settings
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Audit Logs
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [logAction, setLogAction] = useState('');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsMeta, setLogsMeta] = useState({ total: 0, page: 1, totalPages: 1 });

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (activeTab === 'modules') fetchModules();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'settings') fetchSettings();
    if (activeTab === 'logs') fetchLogs();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
  }, [userSearch, roleFilter, usersMeta.page]);

  useEffect(() => {
    if (activeTab === 'logs') fetchLogs();
  }, [logSearch, logAction, logDateFrom, logDateTo, logsMeta.page]);

  /* ── Fetch helpers ── */

  const fetchStats = async () => {
    try {
      const res = await api.get('/admin/stats/dashboard');
      setStats(res.data.data || { totalUsers: 0, activeUsers: 0, todayLogins: 0, pendingApprovals: 0 });
    } catch (err) {
      console.error('Admin stats error:', err);
    }
  };

  const fetchModules = async () => {
    setModulesLoading(true);
    try {
      const res = await api.get('/admin/modules');
      setModules(res.data.data || []);
    } catch (err) {
      console.error('Modules fetch error:', err);
    } finally {
      setModulesLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const params: Record<string, string> = {
        page: usersMeta.page.toString(),
        limit: '20',
      };
      if (userSearch) params.search = userSearch;
      if (roleFilter) params.role = roleFilter;
      const res = await api.get('/admin/users', { params });
      setUsers(res.data.data || []);
      setUsersMeta(res.data.meta || { total: 0, page: 1, totalPages: 1 });
    } catch (err) {
      console.error('Users fetch error:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await api.get('/admin/settings');
      setSettings(res.data.data || []);
    } catch (err) {
      console.error('Settings fetch error:', err);
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const params: Record<string, string> = {
        page: logsMeta.page.toString(),
        limit: '20',
      };
      if (logSearch) params.userId = logSearch;
      if (logAction) params.action = logAction;
      if (logDateFrom) params.from = new Date(logDateFrom).toISOString();
      if (logDateTo) params.to = new Date(logDateTo).toISOString();
      const res = await api.get('/admin/audit-logs', { params });
      setLogs(res.data.data || []);
      setLogsMeta(res.data.meta || { total: 0, page: 1, totalPages: 1 });
    } catch (err) {
      console.error('Logs fetch error:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  /* ── Module toggle ── */
  const handleModuleToggle = async (mod: Module) => {
    try {
      await api.patch(`/admin/modules/${mod.id}`, { isEnabled: !mod.isEnabled });
      setModules((prev) => prev.map((m) => m.id === mod.id ? { ...m, isEnabled: !m.isEnabled } : m));
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '모듈 변경 중 오류가 발생했습니다');
    }
  };

  /* ── User actions ── */
  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await api.patch(`/admin/users/${userId}/role`, { role });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '역할 변경 중 오류가 발생했습니다');
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    try {
      await api.patch(`/admin/users/${userId}/status`, { status });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '상태 변경 중 오류가 발생했습니다');
    }
  };

  /* ── Setting edit ── */
  const startEditSetting = (s: SystemSetting) => {
    setEditingKey(s.key);
    setEditingValue(s.value);
  };

  const handleSaveSetting = async (s: SystemSetting) => {
    try {
      await api.patch(`/admin/settings/${s.id}`, { value: editingValue });
      setSettings((prev) => prev.map((st) => st.id === s.id ? { ...st, value: editingValue } : st));
      setEditingKey(null);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '설정 저장 중 오류가 발생했습니다');
    }
  };

  const formatDateTime = (dt: string) =>
    new Date(dt).toLocaleString('ko-KR', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  /* ── Pagination ── */
  function Pagination({
    meta,
    onPage,
  }: {
    meta: { page: number; totalPages: number };
    onPage: (p: number) => void;
  }) {
    if (meta.totalPages <= 1) return null;
    const pages = Array.from({ length: Math.min(meta.totalPages, 7) }, (_, i) => i + 1);
    return (
      <div className="flex items-center justify-center gap-1 pt-4 border-t mt-4">
        <button
          onClick={() => onPage(meta.page - 1)}
          disabled={meta.page === 1}
          className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`px-3 py-1 rounded text-sm ${
              meta.page === p ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onPage(meta.page + 1)}
          disabled={meta.page === meta.totalPages}
          className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  const STAT_CARDS = [
    { label: '전체 사용자',   value: stats.totalUsers,       icon: Users,      color: 'text-primary-600' },
    { label: '활성 사용자',   value: stats.activeUsers,      icon: UserCheck,  color: 'text-green-600' },
    { label: '오늘 로그인',   value: stats.todayLogins,      icon: LogIn,      color: 'text-yellow-600' },
    { label: '대기중 결재',   value: stats.pendingApprovals, icon: FileCheck,  color: 'text-red-600' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Shield size={24} /> 관리자 콘솔
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-primary-50/50 p-1.5 rounded-2xl w-fit overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === key
                ? 'bg-white shadow-sm text-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ─── 모듈관리 ─── */}
      {activeTab === 'modules' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">모듈 목록</h2>
            <button onClick={fetchModules} className="text-gray-400 hover:text-gray-600">
              <RefreshCw size={16} />
            </button>
          </div>
          {modulesLoading ? (
            <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-gray-400" size={28} /></div>
          ) : modules.length === 0 ? (
            <p className="text-center text-gray-400 py-12">모듈이 없습니다</p>
          ) : (
            <div className="space-y-3">
              {modules.map((mod) => (
                <div
                  key={mod.id}
                  className="flex items-center justify-between py-3 px-4 rounded-2xl border hover:bg-primary-50/50 transition-colors"
                >
                  <div>
                    <p className="font-medium">{mod.displayName}</p>
                    {mod.description && <p className="text-xs text-gray-400 mt-0.5">{mod.description}</p>}
                    <p className="text-xs text-gray-300 mt-0.5">ID: {mod.name}</p>
                  </div>
                  <button
                    onClick={() => handleModuleToggle(mod)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      mod.isEnabled
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {mod.isEnabled
                      ? <><ToggleRight size={18} /> 활성화</>
                      : <><ToggleLeft size={18} /> 비활성</>
                    }
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 사용자관리 ─── */}
      {activeTab === 'users' && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => { setUserSearch(e.target.value); setUsersMeta((m) => ({ ...m, page: 1 })); }}
                placeholder="이름, 사번 검색..."
                className="input-field pl-9 w-52"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); setUsersMeta((m) => ({ ...m, page: 1 })); }}
              className="input-field w-36"
            >
              <option value="">전체 역할</option>
              {Object.entries(ROLE_MAP).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <p className="text-sm text-gray-500 ml-auto">총 {usersMeta.total}명</p>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-gray-400" size={28} /></div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium">사용자</th>
                    <th className="pb-3 font-medium w-24">부서</th>
                    <th className="pb-3 font-medium w-32">역할</th>
                    <th className="pb-3 font-medium w-24">상태</th>
                    <th className="pb-3 font-medium w-36">마지막 로그인</th>
                    <th className="pb-3 font-medium w-28 text-center">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-400">사용자가 없습니다</td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-primary-50/50">
                        <td className="py-3">
                          <div>
                            <p className="font-medium">{u.name}</p>
                            <p className="text-xs text-gray-400">{u.employeeId} · {u.email}</p>
                          </div>
                        </td>
                        <td className="py-3 text-gray-500 text-xs">{u.department?.name || '-'}</td>
                        <td className="py-3">
                          {user?.role === 'super_admin' ? (
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                              className="text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
                              disabled={u.id === user?.id}
                            >
                              {Object.entries(ROLE_MAP).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_MAP[u.role]?.color || 'bg-gray-100 text-gray-600'}`}>
                              {ROLE_MAP[u.role]?.label || u.role}
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_MAP[u.status]?.color || 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_MAP[u.status]?.label || u.status}
                          </span>
                        </td>
                        <td className="py-3 text-xs text-gray-400">
                          {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '없음'}
                        </td>
                        <td className="py-3 text-center">
                          {u.id !== user?.id && (
                            <div className="flex items-center justify-center gap-1">
                              {u.status !== 'active' && (
                                <button
                                  onClick={() => handleStatusChange(u.id, 'active')}
                                  className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600"
                                  title="활성화"
                                >
                                  <UserCheck size={15} />
                                </button>
                              )}
                              {u.status === 'active' && (
                                <button
                                  onClick={() => handleStatusChange(u.id, 'suspended')}
                                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                                  title="정지"
                                >
                                  <UserX size={15} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <Pagination
                meta={usersMeta}
                onPage={(p) => setUsersMeta((m) => ({ ...m, page: p }))}
              />
            </>
          )}
        </div>
      )}

      {/* ─── 시스템설정 ─── */}
      {activeTab === 'settings' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">시스템 설정</h2>
            <button onClick={fetchSettings} className="text-gray-400 hover:text-gray-600">
              <RefreshCw size={16} />
            </button>
          </div>
          {settingsLoading ? (
            <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-gray-400" size={28} /></div>
          ) : settings.length === 0 ? (
            <p className="text-center text-gray-400 py-12">설정 항목이 없습니다</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium w-48">키</th>
                  <th className="pb-3 font-medium">값</th>
                  <th className="pb-3 font-medium">설명</th>
                  <th className="pb-3 font-medium w-20 text-center">편집</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-primary-50/50">
                    <td className="py-3">
                      <p className="font-mono text-xs font-medium">{s.key}</p>
                      {s.category && (
                        <span className="text-xs text-gray-400">{s.category}</span>
                      )}
                    </td>
                    <td className="py-3">
                      {editingKey === s.key ? (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          className="input-field py-1 text-sm"
                          autoFocus
                        />
                      ) : (
                        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{s.value}</span>
                      )}
                    </td>
                    <td className="py-3 text-gray-500 text-xs">{s.description || '-'}</td>
                    <td className="py-3 text-center">
                      {editingKey === s.key ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSaveSetting(s)}
                            className="p-1.5 rounded hover:bg-green-50 text-gray-400 hover:text-green-600"
                            title="저장"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            onClick={() => setEditingKey(null)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                            title="취소"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditSetting(s)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                          title="편집"
                        >
                          <Edit2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ─── 감사로그 ─── */}
      {activeTab === 'logs' && (
        <div className="card">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => { setLogSearch(e.target.value); setLogsMeta((m) => ({ ...m, page: 1 })); }}
                placeholder="사용자 검색..."
                className="input-field pl-9 w-44"
              />
            </div>
            <input
              type="text"
              value={logAction}
              onChange={(e) => { setLogAction(e.target.value); setLogsMeta((m) => ({ ...m, page: 1 })); }}
              placeholder="액션 (ex: LOGIN)"
              className="input-field w-40"
            />
            <input
              type="date"
              value={logDateFrom}
              onChange={(e) => { setLogDateFrom(e.target.value); setLogsMeta((m) => ({ ...m, page: 1 })); }}
              className="input-field w-36"
            />
            <span className="text-gray-400 text-sm">~</span>
            <input
              type="date"
              value={logDateTo}
              onChange={(e) => { setLogDateTo(e.target.value); setLogsMeta((m) => ({ ...m, page: 1 })); }}
              className="input-field w-36"
            />
            <p className="text-sm text-gray-500 ml-auto">총 {logsMeta.total}건</p>
          </div>

          {logsLoading ? (
            <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-gray-400" size={28} /></div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-3 font-medium w-36">액션</th>
                    <th className="pb-3 font-medium w-28">사용자</th>
                    <th className="pb-3 font-medium">리소스</th>
                    <th className="pb-3 font-medium w-28">IP</th>
                    <th className="pb-3 font-medium w-36">날짜</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-400">로그가 없습니다</td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-0 hover:bg-primary-50/50">
                        <td className="py-3">
                          <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{log.action}</span>
                        </td>
                        <td className="py-3 text-gray-700">{log.user.name}</td>
                        <td className="py-3">
                          <span className="text-gray-600">{log.resource}</span>
                          {log.resourceId && (
                            <span className="text-gray-400 text-xs ml-1">#{log.resourceId.slice(0, 8)}</span>
                          )}
                        </td>
                        <td className="py-3 text-gray-400 text-xs font-mono">{log.ipAddress || '-'}</td>
                        <td className="py-3 text-gray-400 text-xs">{formatDateTime(log.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <Pagination
                meta={logsMeta}
                onPage={(p) => setLogsMeta((m) => ({ ...m, page: p }))}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
