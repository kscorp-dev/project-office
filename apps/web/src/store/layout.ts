import { create } from 'zustand';

export type SidebarPosition = 'left' | 'right' | 'top' | 'bottom';

export interface NavGroup {
  id: string;
  label: string;
  children: string[];      // navItem key 목록
  collapsed: boolean;
}

interface LayoutState {
  sidebarPosition: SidebarPosition;
  sidebarOpen: boolean;
  navGroups: NavGroup[];

  setSidebarPosition: (pos: SidebarPosition) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setNavGroups: (groups: NavGroup[]) => void;
  toggleGroup: (id: string) => void;
  resetLayout: () => void;
}

const STORAGE_KEY = 'po-layout-settings';

const DEFAULT_GROUPS: NavGroup[] = [
  { id: 'main',   label: '주요 기능', children: ['dashboard', 'mail', 'approval', 'messenger'], collapsed: false },
  { id: 'work',   label: '업무 관리', children: ['organization', 'attendance', 'calendar', 'board'], collapsed: false },
  { id: 'ops',    label: '운영 관리', children: ['task-orders', 'inventory', 'parking', 'cctv'], collapsed: true },
  { id: 'system', label: '시스템',    children: ['meeting', 'documents', 'admin'], collapsed: true },
];

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
}

function saveSettings(state: Pick<LayoutState, 'sidebarPosition' | 'sidebarOpen' | 'navGroups'>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sidebarPosition: state.sidebarPosition,
    sidebarOpen: state.sidebarOpen,
    navGroups: state.navGroups,
  }));
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const saved = loadSettings();
  return {
    sidebarPosition: saved?.sidebarPosition ?? 'left',
    sidebarOpen: saved?.sidebarOpen ?? true,
    navGroups: saved?.navGroups ?? DEFAULT_GROUPS,

    setSidebarPosition: (pos) => {
      set({ sidebarPosition: pos });
      saveSettings({ ...get(), sidebarPosition: pos });
    },

    toggleSidebar: () => {
      const open = !get().sidebarOpen;
      set({ sidebarOpen: open });
      saveSettings({ ...get(), sidebarOpen: open });
    },

    setSidebarOpen: (open) => {
      set({ sidebarOpen: open });
      saveSettings({ ...get(), sidebarOpen: open });
    },

    setNavGroups: (groups) => {
      set({ navGroups: groups });
      saveSettings({ ...get(), navGroups: groups });
    },

    toggleGroup: (id) => {
      const groups = get().navGroups.map(g =>
        g.id === id ? { ...g, collapsed: !g.collapsed } : g
      );
      set({ navGroups: groups });
      saveSettings({ ...get(), navGroups: groups });
    },

    resetLayout: () => {
      set({ sidebarPosition: 'left', sidebarOpen: true, navGroups: DEFAULT_GROUPS });
      localStorage.removeItem(STORAGE_KEY);
    },
  };
});
