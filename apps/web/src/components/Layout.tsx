import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useLayoutStore, type SidebarPosition, type ThemeMode } from '../store/layout';
import { useMailRealtime } from '../store/mailRealtime';
import {
  LayoutDashboard, FileCheck, MessageSquare, Users, LogOut, Menu, X,
  Camera, Clock, Calendar, Newspaper, ClipboardList, Package, Car,
  Video, FolderOpen, Settings, Leaf, ChevronDown, ChevronRight,
  PanelLeft, PanelRight, PanelTop, PanelBottom, RotateCcw, Cog, Mail,
  GripVertical, Eye, EyeOff, Sun, Moon, Monitor,
} from 'lucide-react';
import { useState, useEffect } from 'react';

/* ── 네비게이션 아이템 정의 ── */
const NAV_ITEMS: Record<string, { to: string; icon: any; label: string }> = {
  dashboard:    { to: '/dashboard',     icon: LayoutDashboard, label: '대시보드' },
  mail:         { to: '/mail',          icon: Mail,            label: '메일' },
  approval:     { to: '/approval',      icon: FileCheck,       label: '전자결재' },
  messenger:    { to: '/messenger',     icon: MessageSquare,   label: '메신저' },
  organization: { to: '/organization',  icon: Users,           label: '조직도' },
  cctv:         { to: '/cctv',          icon: Camera,          label: 'CCTV' },
  attendance:   { to: '/attendance',    icon: Clock,           label: '근무관리' },
  calendar:     { to: '/calendar',      icon: Calendar,        label: '캘린더' },
  board:        { to: '/board',         icon: Newspaper,       label: '게시판' },
  'task-orders':{ to: '/task-orders',   icon: ClipboardList,   label: '작업지시서' },
  inventory:    { to: '/inventory',     icon: Package,         label: '자재관리' },
  parking:      { to: '/parking',      icon: Car,             label: '주차관리' },
  meeting:      { to: '/meeting',       icon: Video,           label: '화상회의' },
  documents:    { to: '/documents',     icon: FolderOpen,      label: '문서관리' },
  admin:        { to: '/admin',         icon: Settings,        label: '관리콘솔' },
};

const POSITION_OPTIONS: { value: SidebarPosition; icon: any; label: string }[] = [
  { value: 'left',   icon: PanelLeft,   label: '왼쪽' },
  { value: 'right',  icon: PanelRight,  label: '오른쪽' },
  { value: 'top',    icon: PanelTop,    label: '위' },
  { value: 'bottom', icon: PanelBottom, label: '아래' },
];

/* ── 사이드바 네비게이션 (세로 모드) ── */
function VerticalNav({ compact }: { compact: boolean }) {
  const { navGroups, hiddenItems, toggleGroup } = useLayoutStore();

  return (
    <nav className="flex-1 py-2 overflow-y-auto">
      {navGroups.map(group => {
        const items = group.children
          .filter(key => !hiddenItems.includes(key))
          .map(key => NAV_ITEMS[key])
          .filter(Boolean);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="mb-1">
            {!compact && (
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex items-center justify-between w-full px-4 py-1.5 text-[10px] uppercase font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 tracking-wider"
              >
                <span>{group.label}</span>
                {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
            {!group.collapsed && items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => { if (item.to === '/mail') useMailRealtime.getState().clearAll(); }}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 px-4 py-2 mx-2 rounded-2xl transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-500 text-white shadow-md shadow-primary-200 dark:shadow-primary-900/30'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 hover:text-primary-700 dark:hover:text-primary-400'
                  }`
                }
              >
                <div className="relative">
                  <item.icon size={18} />
                  {item.to === '/mail' && <MailBadge compact={compact} />}
                </div>
                {!compact && <span className="text-sm font-medium truncate">{item.label}</span>}
                {item.to === '/mail' && !compact && <MailInlineBadge />}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/* ── 상/하단 바 네비게이션 (가로 모드) ── */
function HorizontalNav() {
  const { navGroups, hiddenItems, toggleGroup } = useLayoutStore();

  return (
    <nav className="flex items-center gap-1 px-4 py-1 overflow-x-auto flex-1">
      {navGroups.map(group => {
        const items = group.children
          .filter(key => !hiddenItems.includes(key))
          .map(key => NAV_ITEMS[key])
          .filter(Boolean);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="flex items-center gap-0.5 relative group/g">
            <button
              onClick={() => toggleGroup(group.id)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase font-semibold text-gray-400 hover:text-gray-600 whitespace-nowrap"
            >
              {group.label}
              {group.collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            </button>
            {!group.collapsed && items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-primary-50 hover:text-primary-700'
                  }`
                }
              >
                <item.icon size={14} />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <div className="w-px h-4 bg-gray-200 mx-1 last:hidden" />
          </div>
        );
      })}
    </nav>
  );
}

/* ── 드래그 가능한 메뉴 아이템 ── */
function DraggableMenuItem({
  itemKey, groupId, index, isHidden, onToggleVisibility,
}: {
  itemKey: string; groupId: string; index: number; isHidden: boolean;
  onToggleVisibility: (key: string) => void;
}) {
  const { moveItem, moveItemBetweenGroups } = useLayoutStore();
  const navItem = NAV_ITEMS[itemKey];
  if (!navItem) return null;

  const Icon = navItem.icon;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ key: itemKey, groupId, index }));
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    (e.currentTarget as HTMLElement).classList.add('border-t-2', 'border-primary-400');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('border-t-2', 'border-primary-400');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('border-t-2', 'border-primary-400');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data.groupId === groupId) {
        moveItem(groupId, data.index, index);
      } else {
        moveItemBetweenGroups(data.groupId, groupId, data.key, index);
      }
    } catch { /* ignore */ }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${
        isHidden ? 'opacity-40' : 'hover:bg-gray-50'
      }`}
    >
      <GripVertical size={12} className="text-gray-300 flex-shrink-0" />
      <Icon size={14} className="text-gray-500 flex-shrink-0" />
      <span className={`text-xs flex-1 truncate ${isHidden ? 'line-through text-gray-400' : 'text-gray-700'}`}>
        {navItem.label}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(itemKey); }}
        className={`p-0.5 rounded transition-colors flex-shrink-0 ${
          isHidden ? 'text-gray-300 hover:text-gray-500' : 'text-gray-400 hover:text-primary-500'
        }`}
        title={isHidden ? '메뉴 표시' : '메뉴 숨김'}
      >
        {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
    </div>
  );
}

/* ── 테마 옵션 ── */
const THEME_OPTIONS: { value: ThemeMode; icon: any; label: string }[] = [
  { value: 'light',  icon: Sun,     label: '라이트' },
  { value: 'dark',   icon: Moon,    label: '다크' },
  { value: 'system', icon: Monitor, label: '시스템' },
];

/* ── 설정 패널 ── */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { sidebarPosition, setSidebarPosition, theme, setTheme, navGroups, hiddenItems, toggleItemVisibility, resetLayout } = useLayoutStore();
  const [tab, setTab] = useState<'menu' | 'position' | 'theme'>('menu');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-6 w-96 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">레이아웃 설정</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-500 dark:text-gray-400"><X size={18} /></button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 mb-4 bg-gray-100 dark:bg-slate-700 p-0.5 rounded-lg">
          {(['menu', 'position', 'theme'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t ? 'bg-white dark:bg-slate-600 shadow-sm text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {t === 'menu' ? '메뉴 관리' : t === 'position' ? '메뉴 위치' : '테마'}
            </button>
          ))}
        </div>

        {/* 메뉴 관리 탭 */}
        {tab === 'menu' && (
          <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
            <p className="text-[10px] text-gray-400 mb-3">드래그하여 순서 변경, 눈 아이콘으로 표시/숨김</p>
            {navGroups.map(group => (
              <div key={group.id} className="mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">{group.label}</p>
                <div className="space-y-0.5 bg-gray-50/50 dark:bg-slate-700/50 rounded-xl p-1.5">
                  {group.children.map((key, idx) => (
                    <DraggableMenuItem
                      key={key}
                      itemKey={key}
                      groupId={group.id}
                      index={idx}
                      isHidden={hiddenItems.includes(key)}
                      onToggleVisibility={toggleItemVisibility}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 메뉴 위치 탭 */}
        {tab === 'position' && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">메뉴 위치</p>
            <div className="grid grid-cols-4 gap-2">
              {POSITION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSidebarPosition(opt.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-xs ${
                    sidebarPosition === opt.value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-400'
                      : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-500'
                  }`}
                >
                  <opt.icon size={18} />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 테마 탭 */}
        {tab === 'theme' && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">화면 테마</p>
            <div className="grid grid-cols-3 gap-3">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                    theme === opt.value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-400 shadow-sm'
                      : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-500'
                  }`}
                >
                  <opt.icon size={22} />
                  <span className="text-xs font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-3 text-center">
              {theme === 'system' ? '시스템 설정에 따라 자동 전환됩니다' : theme === 'dark' ? '어두운 배경으로 눈의 피로를 줄여줍니다' : '밝은 배경의 기본 테마입니다'}
            </p>
          </div>
        )}

        {/* 초기화 */}
        <button
          onClick={() => { resetLayout(); onClose(); }}
          className="flex items-center justify-center gap-2 w-full py-2.5 mt-4 text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-xl transition-colors flex-shrink-0"
        >
          <RotateCcw size={14} />
          기본 설정으로 초기화
        </button>
      </div>
    </div>
  );
}

/* ── 다크모드 빠른 토글 버튼 ── */
function ThemeQuickToggle(_: { compact?: boolean }) {
  const { theme, setTheme } = useLayoutStore();
  const cycle = () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    document.documentElement.classList.add('dark-transition');
    setTheme(next);
    setTimeout(() => document.documentElement.classList.remove('dark-transition'), 400);
  };
  const Icon = theme === 'dark' ? Moon : theme === 'system' ? Monitor : Sun;
  return (
    <button
      onClick={cycle}
      className="p-1.5 hover:bg-primary-50 dark:hover:bg-slate-700 rounded-lg text-gray-400 dark:text-gray-500"
      title={`테마: ${theme === 'dark' ? '다크' : theme === 'system' ? '시스템' : '라이트'}`}
    >
      <Icon size={14} />
    </button>
  );
}

/* ── 메일 새 알림 점 (사이드바 컴팩트 모드) ── */
function MailBadge({ compact }: { compact: boolean }) {
  const count = useMailRealtime((s) => s.unreadDelta);
  if (count === 0) return null;
  if (!compact) return null;  // non-compact는 inline 배지 사용
  return (
    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800" />
  );
}

/* ── 메일 인라인 배지 (사이드바 일반 모드) ── */
function MailInlineBadge() {
  const count = useMailRealtime((s) => s.unreadDelta);
  if (count === 0) return null;
  return (
    <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white min-w-[18px] text-center">
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* ── 메인 Layout ── */
export default function Layout() {
  const { user, logout } = useAuthStore();
  const { sidebarPosition, sidebarOpen, toggleSidebar, theme } = useLayoutStore();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  /* system 테마 미디어쿼리 감지 */
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const isVertical = sidebarPosition === 'left' || sidebarPosition === 'right';
  const isHorizontal = !isVertical;

  /* ── 세로 사이드바 (좌/우) ── */
  const verticalSidebar = isVertical && (
    <aside className={`${sidebarOpen ? 'w-56' : 'w-14'} bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 flex flex-col transition-all duration-300 ${
      sidebarPosition === 'left' ? 'border-r' : 'border-l order-2'
    }`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-slate-800">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
              <Leaf className="text-white" size={14} />
            </div>
            <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100">Project Office</h1>
          </div>
        )}
        <div className="flex items-center gap-0.5">
          {sidebarOpen && (
            <>
              <ThemeQuickToggle />
              <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-primary-50 dark:hover:bg-slate-700 rounded-lg text-gray-400 dark:text-gray-500" title="레이아웃 설정">
                <Cog size={14} />
              </button>
            </>
          )}
          <button onClick={toggleSidebar} className="p-1.5 hover:bg-primary-50 dark:hover:bg-slate-700 rounded-lg text-gray-400 dark:text-gray-500">
            {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
          </button>
        </div>
      </div>

      {/* 네비게이션 */}
      <VerticalNav compact={!sidebarOpen} />

      {/* 유저 */}
      <div className="border-t border-gray-100 dark:border-slate-800 p-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
            {user?.name?.[0] || 'U'}
          </div>
          {sidebarOpen && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{user?.name}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{user?.department?.name || user?.position}</p>
            </div>
          )}
        </div>
        {sidebarOpen && (
          <button onClick={handleLogout} className="flex items-center gap-1.5 mt-2 text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors w-full">
            <LogOut size={14} />
            <span>로그아웃</span>
          </button>
        )}
      </div>
    </aside>
  );

  /* ── 가로 바 (상/하) ── */
  const horizontalBar = isHorizontal && (
    <div className={`bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 flex items-center ${
      sidebarPosition === 'top' ? 'border-b' : 'border-t order-2'
    }`}>
      {/* 로고 */}
      <div className="flex items-center gap-2 px-4 border-r border-gray-100 dark:border-slate-800">
        <div className="w-7 h-7 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
          <Leaf className="text-white" size={14} />
        </div>
        <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">Project Office</h1>
      </div>

      {/* 네비게이션 */}
      <HorizontalNav />

      {/* 유저 & 설정 */}
      <div className="flex items-center gap-2 px-4 border-l border-gray-100 dark:border-slate-800">
        <ThemeQuickToggle />
        <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-primary-50 dark:hover:bg-slate-700 rounded-lg text-gray-400 dark:text-gray-500" title="레이아웃 설정">
          <Cog size={14} />
        </button>
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
          {user?.name?.[0] || 'U'}
        </div>
        <button onClick={handleLogout} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-500" title="로그아웃">
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`flex h-screen bg-primary-50/30 dark:bg-slate-950 ${isHorizontal ? 'flex-col' : ''}`}>
      {verticalSidebar}
      {horizontalBar}
      <main className={`flex-1 overflow-auto ${sidebarPosition === 'right' ? 'order-1' : ''}`}>
        <Outlet />
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
