import { useEffect, useState } from 'react';
import {
  Shield, Users, Settings, ScrollText, ToggleLeft, ToggleRight,
  Search, RefreshCw, ChevronLeft, ChevronRight, Edit2, Check, X,
  UserCheck, UserX, LogIn, FileCheck, UserPlus, Eye, EyeOff,
  Mail, Cloud, Wifi, WifiOff, AlertCircle,
  Plus, MoreVertical, KeyRound, HardDrive, Trash2, Copy, Link2,
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

interface Department {
  id: string;
  name: string;
  code: string;
}

interface CreateUserForm {
  employeeId: string;
  name: string;
  email: string;
  password: string;
  role: string;
  departmentId: string;
  position: string;
  phone: string;

  // 메일박스 생성 옵션
  createMailbox: boolean;
  mailboxUsername: string;
  mailboxQuotaGB: number;
  mailboxPasswordMode: 'auto' | 'custom';
  mailboxCustomPassword: string;
}

const EMPTY_USER_FORM: CreateUserForm = {
  employeeId: '', name: '', email: '', password: '',
  role: 'user', departmentId: '', position: '', phone: '',
  createMailbox: false, mailboxUsername: '', mailboxQuotaGB: 10,
  mailboxPasswordMode: 'auto', mailboxCustomPassword: '',
};

type TabKey = 'modules' | 'users' | 'settings' | 'logs' | 'mail';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'modules',  label: '모듈관리',   icon: ToggleLeft },
  { key: 'users',    label: '사용자관리',  icon: Users },
  { key: 'mail',     label: '메일관리',    icon: Mail },
  { key: 'settings', label: '시스템설정',  icon: Settings },
  { key: 'logs',     label: '감사로그',    icon: ScrollText },
];

/* ─────────────────────────── Mail Admin Types ─────────────────────────── */

interface WorkMailOrgInfo {
  organizationId: string;
  alias: string;
  state: string;
  defaultMailDomain: string;
  directoryId: string;
  directoryType: string;
  completedDate: string;
  arn: string;
}

interface WorkMailHealth {
  connected: boolean;
  organization: WorkMailOrgInfo;
  endpoints: { imap: string; smtp: string };
}

interface WorkMailUser {
  userId: string;
  email: string | null;
  name: string;
  displayName: string;
  state: string;
  role: string;
  enabledDate?: string;
  linkedUser?: { userId: string; userName: string; employeeId: string } | null;
  mailAccountId?: string | null;
}

interface LinkableUser {
  id: string;
  name: string;
  employeeId: string;
  email: string;
  role: string;
  department?: { name: string } | null;
}

interface CreateMailboxResult {
  workmailUserId: string;
  email: string;
  mailAccountId: string | null;
  temporaryPassword: string | null;
  hint: string | null;
}

const ROLE_MAP: Record<string, { label: string; color: string }> = {
  super_admin: { label: '최고관리자', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  admin:       { label: '관리자',     color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  dept_admin:  { label: '부서관리자', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
  user:        { label: '일반사용자', color: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300' },
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  active:    { label: '활성',   color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  inactive:  { label: '비활성', color: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400' },
  suspended: { label: '정지',   color: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' },
  pending:   { label: '대기중', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
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

  // Create User Modal
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(EMPTY_USER_FORM);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);

  // Audit Logs
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [logAction, setLogAction] = useState('');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsMeta, setLogsMeta] = useState({ total: 0, page: 1, totalPages: 1 });

  // Mail (WorkMail)
  const [mailHealth, setMailHealth] = useState<WorkMailHealth | null>(null);
  const [mailHealthError, setMailHealthError] = useState<string | null>(null);
  const [mailHealthLoading, setMailHealthLoading] = useState(false);
  const [mailUsers, setMailUsers] = useState<WorkMailUser[]>([]);
  const [mailUsersLoading, setMailUsersLoading] = useState(false);

  // Mail — create / row actions / result popup
  const [showCreateMailbox, setShowCreateMailbox] = useState(false);
  const [linkTarget, setLinkTarget] = useState<WorkMailUser | null>(null);
  const [createResult, setCreateResult] = useState<CreateMailboxResult | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);  // workmailUserId

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (activeTab === 'modules') fetchModules();
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'settings') fetchSettings();
    if (activeTab === 'logs') fetchLogs();
    if (activeTab === 'mail') { fetchMailHealth(); fetchMailUsers(); }
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

  const fetchDepartments = async () => {
    try {
      const res = await api.get('/departments/flat');
      setDepartments(res.data.data || []);
    } catch (err) {
      console.error('Departments fetch error:', err);
    }
  };

  /* ──────────── WorkMail 관리 ──────────── */
  const fetchMailHealth = async () => {
    setMailHealthLoading(true);
    setMailHealthError(null);
    try {
      const res = await api.get('/admin/mail/workmail/health');
      setMailHealth(res.data.data);
    } catch (err: any) {
      setMailHealth(null);
      setMailHealthError(
        err?.response?.data?.error?.message || 'WorkMail 연결 실패',
      );
    } finally {
      setMailHealthLoading(false);
    }
  };

  const fetchMailUsers = async () => {
    setMailUsersLoading(true);
    try {
      const res = await api.get('/admin/mail/workmail/users');
      setMailUsers(res.data.data || []);
    } catch (err) {
      console.error('Mail users fetch error:', err);
      setMailUsers([]);
    } finally {
      setMailUsersLoading(false);
    }
  };

  const handleMailRowResetPassword = async (u: WorkMailUser) => {
    if (!confirm(`${u.email ?? u.name}의 비밀번호를 재설정하시겠습니까?\n(자동으로 강력한 비밀번호가 생성됩니다)`)) return;
    setRowMenuOpen(null);
    try {
      const res = await api.post(`/admin/mail/workmail/users/${u.userId}/reset-password`, {});
      const tempPw = res.data?.data?.temporaryPassword;
      if (tempPw) {
        alert(`비밀번호가 재설정되었습니다.\n\n임시 비밀번호: ${tempPw}\n\n이 비밀번호는 여기서만 확인 가능합니다. 반드시 복사해 전달하세요.`);
      } else {
        alert('비밀번호가 재설정되었습니다.');
      }
      fetchMailUsers();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '재설정 실패');
    }
  };

  const handleMailRowQuota = async (u: WorkMailUser) => {
    const input = prompt(`${u.email ?? u.name}의 쿼터를 MB 단위로 입력하세요\n(100 ~ 51200, 즉 100MB ~ 50GB)`, '10240');
    if (!input) return;
    setRowMenuOpen(null);
    const quotaMB = parseInt(input, 10);
    if (!Number.isFinite(quotaMB) || quotaMB < 100 || quotaMB > 51200) {
      alert('쿼터는 100 ~ 51200 MB 범위여야 합니다');
      return;
    }
    try {
      await api.patch(`/admin/mail/workmail/users/${u.userId}/quota`, { quotaMB });
      alert(`쿼터가 ${quotaMB}MB로 변경되었습니다`);
      fetchMailUsers();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '쿼터 변경 실패');
    }
  };

  const handleMailRowDelete = async (u: WorkMailUser) => {
    if (!confirm(`${u.email ?? u.name} 메일박스를 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며 메일 데이터가 모두 사라집니다.`)) return;
    setRowMenuOpen(null);
    try {
      await api.delete(`/admin/mail/workmail/users/${u.userId}`);
      alert('삭제 완료');
      fetchMailUsers();
    } catch (err: any) {
      alert(err?.response?.data?.error?.message || '삭제 실패');
    }
  };

  const copyTempPassword = async () => {
    if (!createResult?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(createResult.temporaryPassword);
      alert('비밀번호가 클립보드에 복사되었습니다');
    } catch {
      // fallback — 선택 + 복사 안내만
    }
  };

  const openCreateUser = () => {
    setCreateForm(EMPTY_USER_FORM);
    setCreateError('');
    setShowPassword(false);
    setShowCreateUser(true);
    if (departments.length === 0) fetchDepartments();
  };

  const handleCreateUser = async () => {
    if (!createForm.employeeId || !createForm.name || !createForm.email || !createForm.password) {
      setCreateError('사번, 이름, 이메일, 비밀번호는 필수입니다');
      return;
    }
    if (createForm.password.length < 8) {
      setCreateError('비밀번호는 8자 이상이어야 합니다');
      return;
    }
    if (createForm.createMailbox && createForm.mailboxPasswordMode === 'custom' && createForm.mailboxCustomPassword.length < 8) {
      setCreateError('메일 비밀번호는 8자 이상이어야 합니다');
      return;
    }
    setCreateLoading(true);
    setCreateError('');
    try {
      const payload: any = {
        employeeId: createForm.employeeId,
        name: createForm.name,
        email: createForm.email,
        password: createForm.password,
        role: createForm.role,
      };
      if (createForm.departmentId) payload.departmentId = createForm.departmentId;
      if (createForm.position) payload.position = createForm.position;
      if (createForm.phone) payload.phone = createForm.phone;

      // 메일박스 자동 생성 옵션
      if (createForm.createMailbox) {
        payload.createMailbox = true;
        payload.mailboxUsername = (createForm.mailboxUsername || createForm.employeeId).toLowerCase();
        payload.mailboxQuotaMB = Math.round(createForm.mailboxQuotaGB * 1024);
        if (createForm.mailboxPasswordMode === 'custom' && createForm.mailboxCustomPassword) {
          payload.mailboxPassword = createForm.mailboxCustomPassword;
        }
      }

      const { data } = await api.post('/admin/users', payload);
      setShowCreateUser(false);
      fetchUsers();
      fetchStats();

      // 메일박스 생성 결과가 있으면 표시
      if (data.mailbox) {
        setCreateResult({
          workmailUserId: data.mailbox.workmailUserId,
          email: data.mailbox.email,
          mailAccountId: data.mailbox.mailAccountId,
          temporaryPassword: data.mailbox.temporaryPassword,
          hint: data.mailbox.temporaryPassword
            ? '이 비밀번호는 이 창을 닫으면 다시 볼 수 없습니다. 안전한 곳에 저장하세요.'
            : null,
        });
      } else if (data.mailboxError) {
        alert('사용자는 생성됐지만 메일박스 생성 실패:\n' + data.mailboxError);
      }
    } catch (err: any) {
      setCreateError(err.response?.data?.error?.message || '직원 등록 중 오류가 발생했습니다');
    } finally {
      setCreateLoading(false);
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
      <div className="flex items-center justify-center gap-1 pt-4 border-t dark:border-slate-700 mt-4">
        <button
          onClick={() => onPage(meta.page - 1)}
          disabled={meta.page === 1}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 dark:text-gray-400"
        >
          <ChevronLeft size={16} />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`px-3 py-1 rounded text-sm ${
              meta.page === p ? 'bg-primary-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={() => onPage(meta.page + 1)}
          disabled={meta.page === meta.totalPages}
          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 dark:text-gray-400"
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
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2 dark:text-white">
        <Shield size={24} /> 관리자 콘솔
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {STAT_CARDS.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card dark:bg-slate-800 dark:border-slate-700/80 py-4 flex items-center gap-4">
            <Icon size={28} className={color} />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
              <p className="text-2xl font-bold dark:text-white">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-primary-50/50 dark:bg-slate-800/50 p-1.5 rounded-2xl w-fit overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === key
                ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-primary-400'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ─── 모듈관리 ─── */}
      {activeTab === 'modules' && (
        <div className="card dark:bg-slate-800 dark:border-slate-700/80">
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
                  className="flex items-center justify-between py-3 px-4 rounded-2xl border dark:border-slate-700 hover:bg-primary-50/50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div>
                    <p className="font-medium dark:text-white">{mod.displayName}</p>
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
        <div className="card dark:bg-slate-800 dark:border-slate-700/80">
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
            <button
              onClick={openCreateUser}
              className="btn-primary flex items-center gap-1.5 text-sm ml-auto"
            >
              <UserPlus size={15} /> 직원 등록
            </button>
            <a
              href="/admin/users/invite"
              className="btn-secondary flex items-center gap-1.5 text-sm text-primary-700 border-primary-300 hover:bg-primary-50"
            >
              <Mail size={15} /> 이메일 초대
            </a>
            <p className="text-sm text-gray-500 dark:text-gray-400">총 {usersMeta.total}명</p>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-16"><RefreshCw className="animate-spin text-gray-400" size={28} /></div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-slate-700 text-left text-gray-500 dark:text-gray-400">
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
                      <tr key={u.id} className="border-b last:border-0 dark:border-slate-700 hover:bg-primary-50/50 dark:hover:bg-slate-700/50">
                        <td className="py-3">
                          <div>
                            <p className="font-medium dark:text-white">{u.name}</p>
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
        <div className="card dark:bg-slate-800 dark:border-slate-700/80">
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

      {/* ─── 직원 등록 모달 ─── */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateUser(false)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold flex items-center gap-2 dark:text-white">
                <UserPlus size={20} className="text-primary-600" /> 직원 등록
              </h2>
              <button onClick={() => setShowCreateUser(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {createError && (
              <div className="mb-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">
                {createError}
              </div>
            )}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">사번 *</label>
                  <input
                    type="text"
                    value={createForm.employeeId}
                    onChange={(e) => setCreateForm({ ...createForm, employeeId: e.target.value })}
                    placeholder="EMP001"
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">이름 *</label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="홍길동"
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">이메일 *</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="user@company.com"
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">비밀번호 *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    placeholder="8자 이상"
                    className="input-field pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">역할</label>
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                    className="input-field"
                  >
                    {Object.entries(ROLE_MAP).map(([k, v]) => (
                      <option key={k} value={k} disabled={k === 'super_admin' && user?.role !== 'super_admin'}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">부서</label>
                  <select
                    value={createForm.departmentId}
                    onChange={(e) => setCreateForm({ ...createForm, departmentId: e.target.value })}
                    className="input-field"
                  >
                    <option value="">부서 선택</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">직책</label>
                  <input
                    type="text"
                    value={createForm.position}
                    onChange={(e) => setCreateForm({ ...createForm, position: e.target.value })}
                    placeholder="사원, 대리, 과장..."
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">전화번호</label>
                  <input
                    type="tel"
                    value={createForm.phone}
                    onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                    placeholder="010-0000-0000"
                    className="input-field"
                  />
                </div>
              </div>

              {/* ─── 메일박스 생성 옵션 ─── */}
              <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={createForm.createMailbox}
                    onChange={(e) => setCreateForm({ ...createForm, createMailbox: e.target.checked })}
                    className="w-4 h-4 accent-primary-600"
                  />
                  <Mail size={14} className="text-primary-600" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    회사 메일 계정도 함께 생성 (WorkMail)
                  </span>
                </label>

                {createForm.createMailbox && (
                  <div className="mt-3 pl-6 space-y-3 border-l-2 border-primary-100 dark:border-primary-900/30">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                          메일 사용자명
                        </label>
                        <input
                          type="text"
                          value={createForm.mailboxUsername}
                          onChange={(e) => setCreateForm({ ...createForm, mailboxUsername: e.target.value.toLowerCase() })}
                          placeholder={createForm.employeeId.toLowerCase() || 'hong'}
                          className="input-field"
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {(createForm.mailboxUsername || createForm.employeeId || 'hong').toLowerCase()}@ks-corporation.co.kr
                        </p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                          저장공간 (GB)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={createForm.mailboxQuotaGB}
                          onChange={(e) => setCreateForm({ ...createForm, mailboxQuotaGB: Number(e.target.value) || 10 })}
                          className="input-field"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
                        WorkMail 비밀번호
                      </label>
                      <div className="flex gap-3 items-center mb-2 text-sm">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            checked={createForm.mailboxPasswordMode === 'auto'}
                            onChange={() => setCreateForm({ ...createForm, mailboxPasswordMode: 'auto' })}
                          />
                          자동 생성 (권장)
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            checked={createForm.mailboxPasswordMode === 'custom'}
                            onChange={() => setCreateForm({ ...createForm, mailboxPasswordMode: 'custom' })}
                          />
                          직접 입력
                        </label>
                      </div>
                      {createForm.mailboxPasswordMode === 'custom' && (
                        <input
                          type="text"
                          value={createForm.mailboxCustomPassword}
                          onChange={(e) => setCreateForm({ ...createForm, mailboxCustomPassword: e.target.value })}
                          placeholder="8자 이상"
                          className="input-field"
                        />
                      )}
                    </div>

                    <p className="text-xs text-primary-700 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 rounded-lg px-3 py-2 flex items-start gap-1.5">
                      <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                      메일박스 생성 시 앱 사용자와 자동 연결되어 직원이 로그인하면 메일을 바로 사용할 수 있습니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreateUser(false)} className="btn-secondary">
                취소
              </button>
              <button
                onClick={handleCreateUser}
                disabled={createLoading}
                className="btn-primary flex items-center gap-1.5"
              >
                {createLoading ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
                {createForm.createMailbox ? '등록 + 메일박스 생성' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 메일관리 (WorkMail) ─── */}
      {activeTab === 'mail' && (
        <div className="space-y-4">
          {/* 연결 상태 카드 */}
          <div className="card dark:bg-slate-800 dark:border-slate-700/80">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cloud size={18} className="text-primary-600 dark:text-primary-400" />
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">AWS WorkMail 연결 상태</h3>
              </div>
              <button
                onClick={() => { fetchMailHealth(); fetchMailUsers(); }}
                disabled={mailHealthLoading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-sm text-gray-700 dark:text-gray-200"
              >
                <RefreshCw size={14} className={mailHealthLoading ? 'animate-spin' : ''} />
                {mailHealthLoading ? '확인 중...' : '새로고침'}
              </button>
            </div>

            {mailHealthError ? (
              <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                <WifiOff size={18} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">연결 실패</p>
                  <p className="text-xs mt-0.5">{mailHealthError}</p>
                  <p className="text-xs mt-1 opacity-70">
                    .env의 AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, WORKMAIL_ORG_ID 값을 확인하세요.
                  </p>
                </div>
              </div>
            ) : mailHealth ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 mb-3">
                  <Wifi size={16} />
                  <span className="text-sm font-medium">연결 성공</span>
                  <span className="text-xs opacity-70">
                    (조직 상태: {mailHealth.organization.state})
                  </span>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400 text-xs">조직 별칭</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-mono">{mailHealth.organization.alias}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400 text-xs">기본 도메인</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-mono">{mailHealth.organization.defaultMailDomain}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400 text-xs">Organization ID</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-mono text-xs truncate">{mailHealth.organization.organizationId}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400 text-xs">리전</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-mono">
                      {mailHealth.organization.arn.split(':')[3]}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400 text-xs">IMAP 서버</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-mono text-xs">{mailHealth.endpoints.imap}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400 text-xs">SMTP 서버</dt>
                    <dd className="text-gray-800 dark:text-gray-200 font-mono text-xs">{mailHealth.endpoints.smtp}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
                <RefreshCw size={14} className="animate-spin" />
                <span className="text-sm">연결 상태 확인 중...</span>
              </div>
            )}
          </div>

          {/* 사용자 목록 */}
          <div className="card dark:bg-slate-800 dark:border-slate-700/80">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-primary-600 dark:text-primary-400" />
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                  메일 계정 ({mailUsers.length}명)
                </h3>
              </div>
              <button
                onClick={() => setShowCreateMailbox(true)}
                className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-sm"
                disabled={!mailHealth?.connected}
                title={mailHealth?.connected ? '메일박스 생성' : 'WorkMail 연결 후 이용 가능'}
              >
                <Plus size={14} /> 메일박스 생성
              </button>
            </div>

            {mailUsersLoading ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
                <RefreshCw size={18} className="mx-auto animate-spin mb-2" />
                불러오는 중...
              </div>
            ) : mailUsers.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
                <AlertCircle size={18} className="mx-auto mb-2" />
                등록된 메일 계정이 없습니다
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
                      <th className="py-2 px-3 font-medium">이메일</th>
                      <th className="py-2 px-3 font-medium">표시명</th>
                      <th className="py-2 px-3 font-medium">앱 연결</th>
                      <th className="py-2 px-3 font-medium">상태</th>
                      <th className="py-2 px-3 font-medium">활성화일</th>
                      <th className="py-2 px-3 font-medium text-right">작업</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-700/60">
                    {mailUsers.map((u) => (
                      <tr key={u.userId} className="hover:bg-gray-50 dark:hover:bg-slate-700/40">
                        <td className="py-2.5 px-3 font-mono text-gray-800 dark:text-gray-200">
                          {u.email || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{u.displayName}</td>
                        <td className="py-2.5 px-3 text-xs">
                          {u.linkedUser ? (
                            <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                              <Link2 size={12} /> {u.linkedUser.userName}
                              <span className="text-gray-400 ml-1">({u.linkedUser.employeeId})</span>
                            </span>
                          ) : (
                            <span className="text-gray-400">미연결</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              u.state === 'ENABLED'
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                                : u.state === 'DISABLED'
                                ? 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                                : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                            }`}
                          >
                            {u.state}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-500 dark:text-gray-400">
                          {u.enabledDate ? new Date(u.enabledDate).toLocaleString('ko-KR') : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right relative">
                          <button
                            onClick={() => setRowMenuOpen(rowMenuOpen === u.userId ? null : u.userId)}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-500"
                            disabled={u.state !== 'ENABLED'}
                          >
                            <MoreVertical size={14} />
                          </button>
                          {rowMenuOpen === u.userId && (
                            <div className="absolute right-3 top-full mt-1 z-20 w-48 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg py-1">
                              {!u.linkedUser && (
                                <>
                                  <button
                                    onClick={() => { setRowMenuOpen(null); setLinkTarget(u); }}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-primary-700 dark:text-primary-400 font-medium"
                                  >
                                    <Link2 size={14} /> 앱 사용자와 연결
                                  </button>
                                  <div className="border-t border-gray-100 dark:border-slate-700 my-1" />
                                </>
                              )}
                              <button
                                onClick={() => handleMailRowResetPassword(u)}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-gray-700 dark:text-gray-200"
                              >
                                <KeyRound size={14} /> 비밀번호 재설정
                              </button>
                              <button
                                onClick={() => handleMailRowQuota(u)}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 text-gray-700 dark:text-gray-200"
                              >
                                <HardDrive size={14} /> 쿼터 변경
                              </button>
                              <div className="border-t border-gray-100 dark:border-slate-700 my-1" />
                              <button
                                onClick={() => handleMailRowDelete(u)}
                                className="w-full text-left px-3 py-1.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2 text-red-600 dark:text-red-400"
                              >
                                <Trash2 size={14} /> 메일박스 삭제
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                  ℹ️ 메일박스 삭제는 되돌릴 수 없습니다. 비활성화만 원한다면 비밀번호 재설정 후 사용자에게 비번을 공유하지 마세요.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── 감사로그 ─── */}
      {activeTab === 'logs' && (
        <div className="card dark:bg-slate-800 dark:border-slate-700/80">
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

      {/* ─── 메일박스 생성 모달 ─── */}
      {showCreateMailbox && (
        <CreateMailboxModal
          onClose={() => setShowCreateMailbox(false)}
          onCreated={(result) => {
            setShowCreateMailbox(false);
            setCreateResult(result);
            fetchMailUsers();
          }}
        />
      )}

      {/* ─── 기존 WorkMail 계정 → 앱 User 연결 모달 ─── */}
      {linkTarget && (
        <LinkMailboxModal
          target={linkTarget}
          onClose={() => setLinkTarget(null)}
          onLinked={() => {
            setLinkTarget(null);
            fetchMailUsers();
          }}
        />
      )}

      {/* ─── 생성 결과 (임시 비번 노출) 모달 ─── */}
      {createResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateResult(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <Check size={20} className="text-green-600" />
              <h3 className="font-bold text-gray-800 dark:text-gray-100">메일박스 생성 완료</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400">이메일</label>
                <div className="font-mono text-gray-800 dark:text-gray-200">{createResult.email}</div>
              </div>
              {createResult.temporaryPassword && (
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">임시 비밀번호 (1회만 표시)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-100 dark:bg-slate-900 px-3 py-2 rounded-lg font-mono text-sm text-gray-800 dark:text-gray-200 break-all">
                      {createResult.temporaryPassword}
                    </code>
                    <button
                      onClick={copyTempPassword}
                      className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:bg-primary-200"
                      title="복사"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-2 flex items-start gap-1">
                    <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                    {createResult.hint || '이 비밀번호는 이 창을 닫으면 다시 볼 수 없습니다. 안전한 곳에 저장하세요.'}
                  </p>
                </div>
              )}
              {createResult.mailAccountId && (
                <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                  <Link2 size={12} /> 앱 사용자와 연결됨 — 로그인 시 메일 바로 사용 가능
                </div>
              )}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setCreateResult(null)} className="btn-primary">
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════
   메일박스 생성 모달
   ═══════════════════════════════════ */
function CreateMailboxModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateMailboxResult) => void;
}) {
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    firstName: '',
    lastName: '',
    linkUserId: '',
    customPassword: '',
    useAutoPassword: true,
    hiddenFromGAL: false,
  });
  const [linkable, setLinkable] = useState<LinkableUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/admin/mail/linkable-users').then(({ data }) => setLinkable(data.data || []));
  }, []);

  // 연결 유저 선택 시 자동 채우기
  const handleLinkUser = (userId: string) => {
    const u = linkable.find((x) => x.id === userId);
    setForm((f) => ({
      ...f,
      linkUserId: userId,
      displayName: u?.name || f.displayName,
      // 이메일 로컬파트 자동 추출 (예: hong@kscorp.kr → hong)
      username: u?.email ? u.email.split('@')[0].toLowerCase() : f.username,
    }));
  };

  const validate = (): string | null => {
    if (!/^[a-z0-9._-]{1,64}$/.test(form.username)) {
      return '사용자명은 영소문자/숫자/./_/- 만 허용됩니다 (최대 64자)';
    }
    if (!form.displayName.trim()) return '표시명을 입력하세요';
    if (!form.useAutoPassword) {
      if (form.customPassword.length < 8) return '비밀번호는 8자 이상이어야 합니다';
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        username: form.username,
        displayName: form.displayName,
        hiddenFromGAL: form.hiddenFromGAL,
      };
      if (form.firstName) body.firstName = form.firstName;
      if (form.lastName) body.lastName = form.lastName;
      if (form.linkUserId) body.linkUserId = form.linkUserId;
      if (!form.useAutoPassword && form.customPassword) body.password = form.customPassword;

      const { data } = await api.post('/admin/mail/workmail/users', body);
      onCreated(data.data);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '생성 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-primary-600" />
            <h3 className="font-bold text-gray-800 dark:text-gray-100">메일박스 생성</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* 기존 User 연결 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              연결할 사용자 (선택)
            </label>
            <select
              value={form.linkUserId}
              onChange={(e) => handleLinkUser(e.target.value)}
              className="input-field w-full"
            >
              <option value="">연결 안 함 (외부 용도)</option>
              {linkable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.employeeId}) {u.department ? `— ${u.department.name}` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              선택하면 해당 직원이 로그인 시 메일을 바로 사용할 수 있습니다. 비밀번호도 앱에 자동 저장됩니다.
            </p>
          </div>

          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">사용자명 *</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                className="input-field w-full"
                placeholder="hong"
              />
              <p className="text-xs text-gray-400 mt-0.5">{form.username || 'hong'}@ks-corporation.co.kr</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">표시명 *</label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="input-field w-full"
                placeholder="홍길동"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">성 (선택)</label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="input-field w-full"
                placeholder="홍"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">이름 (선택)</label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                className="input-field w-full"
                placeholder="길동"
              />
            </div>
          </div>

          {/* 비밀번호 옵션 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">비밀번호</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={form.useAutoPassword}
                  onChange={() => setForm({ ...form, useAutoPassword: true })}
                />
                <span className="text-sm">자동 생성 (권장 — 20자 강력한 비밀번호)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!form.useAutoPassword}
                  onChange={() => setForm({ ...form, useAutoPassword: false })}
                />
                <span className="text-sm">직접 입력</span>
              </label>
              {!form.useAutoPassword && (
                <input
                  type="text"
                  value={form.customPassword}
                  onChange={(e) => setForm({ ...form, customPassword: e.target.value })}
                  placeholder="8자 이상"
                  className="input-field w-full"
                />
              )}
            </div>
          </div>

          {/* 옵션 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.hiddenFromGAL}
              onChange={(e) => setForm({ ...form, hiddenFromGAL: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">전체 주소록에서 숨김</span>
          </label>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary" disabled={submitting}>
            취소
          </button>
          <button onClick={handleSubmit} className="btn-primary" disabled={submitting}>
            {submitting ? '생성 중...' : '메일박스 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════
   기존 WorkMail 계정 → 앱 User 연결 모달 (방법 A)
   ═══════════════════════════════════ */
function LinkMailboxModal({
  target,
  onClose,
  onLinked,
}: {
  target: WorkMailUser;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [linkable, setLinkable] = useState<LinkableUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/admin/mail/linkable-users').then(({ data }) => setLinkable(data.data || []));
  }, []);

  const handleSubmit = async () => {
    setError(null);
    if (!selectedUserId) { setError('연결할 앱 사용자를 선택하세요'); return; }
    if (!password.trim()) { setError('현재 WorkMail 비밀번호를 입력하세요'); return; }

    setSubmitting(true);
    try {
      await api.post('/admin/mail/workmail/link', {
        userId: selectedUserId,
        workmailUserId: target.userId,
        password: password.trim(),
      });
      onLinked();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || '연결 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedUser = linkable.find((u) => u.id === selectedUserId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Link2 size={18} className="text-primary-600" />
            <h3 className="font-bold text-gray-800 dark:text-gray-100">앱 사용자와 연결</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 대상 메일 정보 */}
          <div className="rounded-xl bg-gray-50 dark:bg-slate-900/40 px-3 py-2.5">
            <div className="text-xs text-gray-500 dark:text-gray-400">연결할 메일박스</div>
            <div className="font-mono text-sm text-gray-800 dark:text-gray-200 mt-0.5">
              {target.email || '—'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {target.displayName}
            </div>
          </div>

          {/* 연결할 앱 사용자 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              연결할 앱 사용자 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="input-field w-full"
            >
              <option value="">선택하세요</option>
              {linkable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.employeeId}) {u.department ? `— ${u.department.name}` : ''}
                </option>
              ))}
            </select>
            {selectedUser && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                계정 이메일: {selectedUser.email}
              </p>
            )}
          </div>

          {/* 현재 비밀번호 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              현재 WorkMail 비밀번호 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="SOGo 웹메일 로그인 시 사용하는 비밀번호"
                className="input-field w-full pr-10"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              비밀번호는 AES-256-GCM으로 암호화되어 DB에 저장됩니다. 저장 후에는 복호화 키가 있어야만 복원 가능합니다.
            </p>
          </div>

          {/* 경고 */}
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="text-xs">
              비밀번호가 틀리면 앱에서 IMAP/SMTP 연결이 실패합니다. 비밀번호를 모를 때는
              먼저 <b>⋮ → 비밀번호 재설정</b>으로 새 비번을 만든 후 다시 이 창에서 연결하세요.
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary" disabled={submitting}>
            취소
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary flex items-center gap-1.5"
            disabled={submitting || !selectedUserId || !password.trim()}
          >
            {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Link2 size={14} />}
            {submitting ? '연결 중...' : '연결하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
