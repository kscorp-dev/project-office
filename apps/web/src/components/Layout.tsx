import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import {
  LayoutDashboard, FileCheck, MessageSquare, Users, LogOut, Menu, X, ChevronDown,
  Camera, Clock, Calendar, Newspaper, ClipboardList, Package,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: '대시보드' },
  { to: '/approval', icon: FileCheck, label: '전자결재' },
  { to: '/messenger', icon: MessageSquare, label: '메신저' },
  { to: '/organization', icon: Users, label: '조직도' },
  { to: '/cctv', icon: Camera, label: 'CCTV' },
  { to: '/attendance', icon: Clock, label: '근태관리' },
  { to: '/calendar', icon: Calendar, label: '캘린더' },
  { to: '/board', icon: Newspaper, label: '게시판' },
  { to: '/task-orders', icon: ClipboardList, label: '작업지시서' },
  { to: '/inventory', icon: Package, label: '자재관리' },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-60' : 'w-16'} bg-dark-900 text-white flex flex-col transition-all duration-200`}>
        <div className="flex items-center justify-between p-4 border-b border-dark-800">
          {sidebarOpen && <h1 className="text-lg font-bold">Project Office</h1>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1 hover:bg-dark-800 rounded">
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <nav className="flex-1 py-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors ${
                  isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-dark-800 hover:text-white'
                }`
              }
            >
              <Icon size={20} />
              {sidebarOpen && <span className="text-sm">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-dark-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-sm font-bold">
              {user?.name?.[0] || 'U'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                <p className="text-xs text-gray-400 truncate">{user?.department?.name || user?.position}</p>
              </div>
            )}
          </div>
          {sidebarOpen && (
            <button onClick={handleLogout} className="flex items-center gap-2 mt-3 text-sm text-gray-400 hover:text-white transition-colors w-full">
              <LogOut size={16} />
              <span>로그아웃</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
