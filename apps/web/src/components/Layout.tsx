import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useLayoutStore, type SidebarPosition } from '../store/layout';
import {
  LayoutDashboard, FileCheck, MessageSquare, Users, LogOut, Menu, X,
  Camera, Clock, Calendar, Newspaper, ClipboardList, Package,
  Video, FolderOpen, Settings, Leaf, ChevronDown, ChevronRight,
  PanelLeft, PanelRight, PanelTop, PanelBottom, RotateCcw, Cog,
} from 'lucide-react';
import { useState } from 'react';

/* ── 네비게이션 아이템 정의 ── */
const NAV_ITEMS: Record<string, { to: string; icon: any; label: string }> = {
  dashboard:    { to: '/dashboard',     icon: LayoutDashboard, label: '대시보드' },
  approval:     { to: '/approval',      icon: FileCheck,       label: '전자결재' },
  messenger:    { to: '/messenger',     icon: MessageSquare,   label: '메신저' },
  organization: { to: '/organization',  icon: Users,           label: '조직도' },
  cctv:         { to: '/cctv',          icon: Camera,          label: 'CCTV' },
  attendance:   { to: '/attendance',    icon: Clock,           label: '근태관리' },
  calendar:     { to: '/calendar',      icon: Calendar,        label: '캘린더' },
  board:        { to: '/board',         icon: Newspaper,       label: '게시판' },
  'task-orders':{ to: '/task-orders',   icon: ClipboardList,   label: '작업지시서' },
  inventory:    { to: '/inventory',     icon: Package,         label: '자재관리' },
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
  const { navGroups, toggleGroup } = useLayoutStore();

  return (
    <nav className="flex-1 py-2 overflow-y-auto">
      {navGroups.map(group => {
        const items = group.children.map(key => NAV_ITEMS[key]).filter(Boolean);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="mb-1">
            {!compact && (
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex items-center justify-between w-full px-4 py-1.5 text-[10px] uppercase font-semibold text-gray-400 hover:text-gray-600 tracking-wider"
              >
                <span>{group.label}</span>
                {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
            {!group.collapsed && items.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 mx-2 rounded-2xl transition-all duration-200 ${
                    isActive
                      ? 'bg-primary-500 text-white shadow-md shadow-primary-200'
                      : 'text-gray-500 hover:bg-primary-50 hover:text-primary-700'
                  }`
                }
              >
                <item.icon size={18} />
                {!compact && <span className="text-sm font-medium truncate">{item.label}</span>}
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
  const { navGroups, toggleGroup } = useLayoutStore();

  return (
    <nav className="flex items-center gap-1 px-4 py-1 overflow-x-auto flex-1">
      {navGroups.map(group => {
        const items = group.children.map(key => NAV_ITEMS[key]).filter(Boolean);
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

/* ── 설정 패널 ── */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { sidebarPosition, setSidebarPosition, resetLayout } = useLayoutStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800">레이아웃 설정</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* 메뉴 위치 */}
        <div className="mb-5">
          <p className="text-xs font-medium text-gray-500 mb-2">메뉴 위치</p>
          <div className="grid grid-cols-4 gap-2">
            {POSITION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSidebarPosition(opt.value)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-xs ${
                  sidebarPosition === opt.value
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <opt.icon size={18} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 초기화 */}
        <button
          onClick={() => { resetLayout(); onClose(); }}
          className="flex items-center justify-center gap-2 w-full py-2.5 text-sm text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
        >
          <RotateCcw size={14} />
          기본 설정으로 초기화
        </button>
      </div>
    </div>
  );
}

/* ── 메인 Layout ── */
export default function Layout() {
  const { user, logout } = useAuthStore();
  const { sidebarPosition, sidebarOpen, toggleSidebar } = useLayoutStore();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  const isVertical = sidebarPosition === 'left' || sidebarPosition === 'right';
  const isHorizontal = !isVertical;

  /* ── 세로 사이드바 (좌/우) ── */
  const verticalSidebar = isVertical && (
    <aside className={`${sidebarOpen ? 'w-56' : 'w-14'} bg-white border-gray-200 flex flex-col transition-all duration-300 ${
      sidebarPosition === 'left' ? 'border-r' : 'border-l order-2'
    }`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 border-b border-gray-100">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
              <Leaf className="text-white" size={14} />
            </div>
            <h1 className="text-sm font-bold text-gray-800">Project Office</h1>
          </div>
        )}
        <div className="flex items-center gap-0.5">
          {sidebarOpen && (
            <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-primary-50 rounded-lg text-gray-400" title="레이아웃 설정">
              <Cog size={14} />
            </button>
          )}
          <button onClick={toggleSidebar} className="p-1.5 hover:bg-primary-50 rounded-lg text-gray-400">
            {sidebarOpen ? <X size={14} /> : <Menu size={14} />}
          </button>
        </div>
      </div>

      {/* 네비게이션 */}
      <VerticalNav compact={!sidebarOpen} />

      {/* 유저 */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
            {user?.name?.[0] || 'U'}
          </div>
          {sidebarOpen && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{user?.name}</p>
              <p className="text-[10px] text-gray-400 truncate">{user?.department?.name || user?.position}</p>
            </div>
          )}
        </div>
        {sidebarOpen && (
          <button onClick={handleLogout} className="flex items-center gap-1.5 mt-2 text-xs text-gray-400 hover:text-red-500 transition-colors w-full">
            <LogOut size={14} />
            <span>로그아웃</span>
          </button>
        )}
      </div>
    </aside>
  );

  /* ── 가로 바 (상/하) ── */
  const horizontalBar = isHorizontal && (
    <div className={`bg-white border-gray-200 flex items-center ${
      sidebarPosition === 'top' ? 'border-b' : 'border-t order-2'
    }`}>
      {/* 로고 */}
      <div className="flex items-center gap-2 px-4 border-r border-gray-100">
        <div className="w-7 h-7 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
          <Leaf className="text-white" size={14} />
        </div>
        <h1 className="text-sm font-bold text-gray-800 whitespace-nowrap">Project Office</h1>
      </div>

      {/* 네비게이션 */}
      <HorizontalNav />

      {/* 유저 & 설정 */}
      <div className="flex items-center gap-2 px-4 border-l border-gray-100">
        <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-primary-50 rounded-lg text-gray-400" title="레이아웃 설정">
          <Cog size={14} />
        </button>
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
          {user?.name?.[0] || 'U'}
        </div>
        <button onClick={handleLogout} className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500" title="로그아웃">
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`flex h-screen bg-primary-50/30 ${isHorizontal ? 'flex-col' : ''}`}>
      {verticalSidebar}
      {horizontalBar}
      <main className={`flex-1 overflow-auto ${sidebarPosition === 'right' ? 'order-1' : ''}`}>
        <Outlet />
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
