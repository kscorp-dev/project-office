import { create } from 'zustand';

export type SidebarPosition = 'left' | 'right' | 'top' | 'bottom';
export type ThemeMode = 'light' | 'dark' | 'system';

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
  hiddenItems: string[];   // 숨김 처리된 메뉴 키
  theme: ThemeMode;

  setSidebarPosition: (pos: SidebarPosition) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setNavGroups: (groups: NavGroup[]) => void;
  toggleGroup: (id: string) => void;
  toggleItemVisibility: (key: string) => void;
  moveItem: (groupId: string, fromIdx: number, toIdx: number) => void;
  moveItemBetweenGroups: (fromGroupId: string, toGroupId: string, itemKey: string, toIdx: number) => void;
  setTheme: (mode: ThemeMode) => void;
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

function saveSettings(state: Pick<LayoutState, 'sidebarPosition' | 'sidebarOpen' | 'navGroups' | 'hiddenItems' | 'theme'>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sidebarPosition: state.sidebarPosition,
    sidebarOpen: state.sidebarOpen,
    navGroups: state.navGroups,
    hiddenItems: state.hiddenItems,
    theme: state.theme,
  }));
}

/** 실제 다크모드를 DOM에 적용 */
function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const saved = loadSettings();
  const initialTheme: ThemeMode = (saved?.theme as ThemeMode) ?? 'light';
  // 스토어 초기화 시 DOM에 테마 즉시 적용 (index.html 스크립트와 동기화)
  applyTheme(initialTheme);
  return {
    sidebarPosition: saved?.sidebarPosition ?? 'left',
    sidebarOpen: saved?.sidebarOpen ?? true,
    navGroups: saved?.navGroups ?? DEFAULT_GROUPS,
    hiddenItems: saved?.hiddenItems ?? [],
    theme: (saved?.theme as ThemeMode) ?? 'light',

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

    toggleItemVisibility: (key) => {
      const hidden = get().hiddenItems;
      const next = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key];
      set({ hiddenItems: next });
      saveSettings({ ...get(), hiddenItems: next });
    },

    moveItem: (groupId, fromIdx, toIdx) => {
      const groups = get().navGroups.map(g => {
        if (g.id !== groupId) return g;
        const children = [...g.children];
        const [item] = children.splice(fromIdx, 1);
        children.splice(toIdx, 0, item);
        return { ...g, children };
      });
      set({ navGroups: groups });
      saveSettings({ ...get(), navGroups: groups });
    },

    moveItemBetweenGroups: (fromGroupId, toGroupId, itemKey, toIdx) => {
      const groups = get().navGroups.map(g => {
        if (g.id === fromGroupId) {
          return { ...g, children: g.children.filter(k => k !== itemKey) };
        }
        if (g.id === toGroupId) {
          const children = [...g.children];
          children.splice(toIdx, 0, itemKey);
          return { ...g, children };
        }
        return g;
      });
      set({ navGroups: groups });
      saveSettings({ ...get(), navGroups: groups });
    },

    setTheme: (mode) => {
      set({ theme: mode });
      applyTheme(mode);
      saveSettings({ ...get(), theme: mode });
    },

    resetLayout: () => {
      set({ sidebarPosition: 'left', sidebarOpen: true, navGroups: DEFAULT_GROUPS, hiddenItems: [], theme: 'light' });
      applyTheme('light');
      localStorage.removeItem(STORAGE_KEY);
    },
  };
});
