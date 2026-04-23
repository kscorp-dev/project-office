/**
 * 기능 모듈 활성화 상태 스토어
 *
 * - 로그인 후 `/api/modules` 호출 → 모듈 이름 → 활성 여부 맵 보관
 * - Layout 네비게이션에서 `isEnabled(name)` 으로 필터링
 * - AdminConsole 에서 토글 후 `refresh()` 호출하면 사이드바도 즉시 반영
 */
import { create } from 'zustand';
import { api } from '../services/api';

/** Layout nav 키 → 실제 FeatureModule.name 매핑
 *  admin/dashboard/organization/mail 은 항상 노출되어야 하므로 매핑 생략 */
export const NAV_TO_MODULE: Record<string, string> = {
  approval: 'approval',
  messenger: 'messenger',
  cctv: 'cctv',
  attendance: 'attendance',
  calendar: 'calendar',
  board: 'board',
  'task-orders': 'task_orders',
  inventory: 'inventory',
  parking: 'parking',
  meeting: 'meeting',
  documents: 'document',
};

interface ModulesState {
  /** name → isEnabled */
  map: Record<string, boolean>;
  loaded: boolean;
  loading: boolean;

  fetch: () => Promise<void>;
  /** AdminConsole 토글 후 최신 상태 재조회 */
  refresh: () => Promise<void>;
  /** navKey(=Layout nav 키)가 활성 모듈에 해당하는지. 매핑 없으면 true */
  isNavEnabled: (navKey: string) => boolean;
  /** FeatureModule.name 으로 활성 여부 조회 */
  isEnabled: (name: string) => boolean;
  reset: () => void;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  map: {},
  loaded: false,
  loading: false,

  fetch: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const { data } = await api.get('/modules');
      const next: Record<string, boolean> = {};
      for (const m of data.data as { name: string; isEnabled: boolean }[]) {
        next[m.name] = m.isEnabled;
      }
      set({ map: next, loaded: true, loading: false });
    } catch {
      // 오류 시 빈 맵 유지 → isNavEnabled 기본값(true)로 네비게이션 유지
      set({ loading: false });
    }
  },

  refresh: async () => {
    set({ loaded: false });
    await get().fetch();
  },

  isNavEnabled: (navKey: string): boolean => {
    const modName = NAV_TO_MODULE[navKey];
    if (!modName) return true; // 매핑 없는 메뉴는 항상 노출
    if (!get().loaded) return true; // 로드 전에는 깜빡임 방지 위해 전부 노출
    return get().map[modName] !== false;
  },

  isEnabled: (name: string): boolean => {
    if (!get().loaded) return true;
    return get().map[name] !== false;
  },

  reset: () => set({ map: {}, loaded: false, loading: false }),
}));
