import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { Responsive, useContainerWidth } from 'react-grid-layout';
import type { Layout, Layouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  FileCheck, MessageSquare, Camera, ClipboardList, Users, Calendar,
  Clock, Newspaper, Package, Video, FolderOpen, Settings,
  ChevronLeft, ChevronRight, Bell, Mail, Shield,
  CheckCircle2, AlertCircle, Timer, ArrowRight,
  GripVertical, Pencil, RotateCcw, Plus, X, Eye, EyeOff,
} from 'lucide-react';

// useContainerWidth 훅으로 컨테이너 너비 감지

/* ── localStorage 키 ── */
const LAYOUT_KEY = 'po-dashboard-layouts';
const HIDDEN_KEY = 'po-dashboard-hidden';

/* ── 위젯 정의 ── */
interface WidgetDef {
  id: string;
  title: string;
  icon: any;
  iconColor: string;
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
}

const WIDGET_DEFS: WidgetDef[] = [
  { id: 'profile',    title: '프로필',      icon: Users,         iconColor: 'text-primary-600', minW: 2, minH: 3, defaultW: 4, defaultH: 4 },
  { id: 'shortcuts',  title: '바로가기',    icon: Settings,      iconColor: 'text-gray-600',    minW: 2, minH: 3, defaultW: 4, defaultH: 5 },
  { id: 'calendar',   title: '캘린더',      icon: Calendar,      iconColor: 'text-primary-500', minW: 2, minH: 4, defaultW: 4, defaultH: 6 },
  { id: 'approval',   title: '전자결재',    icon: FileCheck,     iconColor: 'text-primary-600', minW: 3, minH: 3, defaultW: 5, defaultH: 5 },
  { id: 'taskorders', title: '작업지시서',  icon: ClipboardList, iconColor: 'text-amber-500',   minW: 3, minH: 3, defaultW: 5, defaultH: 5 },
  { id: 'board',      title: '최근 게시글', icon: Newspaper,     iconColor: 'text-rose-400',    minW: 3, minH: 3, defaultW: 5, defaultH: 4 },
  { id: 'attendance', title: '근무 체크',   icon: Clock,         iconColor: 'text-primary-500', minW: 2, minH: 3, defaultW: 3, defaultH: 5 },
  { id: 'memo',       title: '메모',        icon: Pencil,        iconColor: 'text-primary-400', minW: 2, minH: 2, defaultW: 3, defaultH: 3 },
  { id: 'cctv',       title: 'CCTV',        icon: Camera,        iconColor: 'text-slate-600',   minW: 2, minH: 3, defaultW: 3, defaultH: 4 },
  { id: 'alerts',     title: '알림',        icon: Bell,          iconColor: 'text-amber-500',   minW: 2, minH: 2, defaultW: 3, defaultH: 3 },
];

/* ── 기본 레이아웃 ── */
function getDefaultLayouts(): Layouts {
  const lg: Layout[] = [
    { i: 'profile',    x: 0,  y: 0,  w: 4, h: 4 },
    { i: 'shortcuts',  x: 0,  y: 4,  w: 4, h: 5 },
    { i: 'calendar',   x: 0,  y: 9,  w: 4, h: 6 },
    { i: 'approval',   x: 4,  y: 0,  w: 5, h: 5 },
    { i: 'taskorders', x: 4,  y: 5,  w: 5, h: 5 },
    { i: 'board',      x: 4,  y: 10, w: 5, h: 4 },
    { i: 'attendance', x: 9,  y: 0,  w: 3, h: 5 },
    { i: 'memo',       x: 9,  y: 5,  w: 3, h: 3 },
    { i: 'cctv',       x: 9,  y: 8,  w: 3, h: 4 },
    { i: 'alerts',     x: 9,  y: 12, w: 3, h: 3 },
  ];
  return { lg };
}

/* ── quick-access 모듈 ── */
const quickModules = [
  { icon: FileCheck, label: '전자결재', to: '/approval', color: 'bg-green-500' },
  { icon: MessageSquare, label: '메신저', to: '/messenger', color: 'bg-emerald-500' },
  { icon: Users, label: '조직도', to: '/organization', color: 'bg-teal-500' },
  { icon: Calendar, label: '캘린더', to: '/calendar', color: 'bg-lime-600' },
  { icon: Camera, label: 'CCTV', to: '/cctv', color: 'bg-slate-500' },
  { icon: Clock, label: '근태관리', to: '/attendance', color: 'bg-amber-500' },
  { icon: Newspaper, label: '게시판', to: '/board', color: 'bg-rose-400' },
  { icon: ClipboardList, label: '작업지시서', to: '/task-orders', color: 'bg-orange-500' },
  { icon: Package, label: '자재관리', to: '/inventory', color: 'bg-cyan-600' },
  { icon: Video, label: '화상회의', to: '/meeting', color: 'bg-red-400' },
  { icon: FolderOpen, label: '문서관리', to: '/documents', color: 'bg-sky-500' },
  { icon: Settings, label: '관리콘솔', to: '/admin', color: 'bg-gray-500' },
];

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/* ── 실시간 시계 훅 ── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ── 미니 캘린더 ── */
function MiniCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const prev = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const next = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  const cells: { day: number; current: boolean; isToday: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevDays - i, current: false, isToday: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, current: true, isToday: d === today.getDate() && month === today.getMonth() && year === today.getFullYear() });
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) for (let d = 1; d <= remaining; d++) cells.push({ day: d, current: false, isToday: false });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={prev} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronLeft size={16} /></button>
        <span className="font-semibold text-sm text-gray-800">{year}년 {month + 1}월</span>
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="text-xs px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600">오늘</button>
          <button onClick={next} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {DAY_NAMES.map((d, i) => (
          <div key={d} className={`py-1.5 font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{d}</div>
        ))}
        {cells.map((c, i) => (
          <div key={i} className={`py-1.5 text-xs rounded-lg ${c.isToday ? 'bg-primary-500 text-white font-bold' : ''} ${!c.current ? 'text-gray-300' : c.isToday ? '' : 'text-gray-700'} ${i % 7 === 0 && c.current && !c.isToday ? 'text-red-400' : ''} ${i % 7 === 6 && c.current && !c.isToday ? 'text-blue-400' : ''}`}>
            {c.day}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   위젯 콘텐츠 렌더러
   ══════════════════════════════════════════ */
function WidgetContent({ id, navigate, user, now, memo, setMemo, checkedIn, setCheckedIn }: any) {
  const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  switch (id) {
    case 'profile':
      return (
        <>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-lg font-bold text-white shadow-md">
              {user?.name?.[0] || 'U'}
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">{user?.name || '사용자'}</h2>
              <p className="text-xs text-gray-500">{user?.department?.name || '(주)KS코퍼레이션'}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { icon: Calendar, label: '오늘 일정', count: 0, color: 'text-primary-600', bg: 'bg-primary-50' },
              { icon: Mail, label: '메시지', count: 0, color: 'text-emerald-500', bg: 'bg-emerald-50' },
              { icon: FileCheck, label: '대기 결재', count: 0, color: 'text-orange-500', bg: 'bg-orange-50' },
              { icon: Shield, label: '진행 작업', count: 0, color: 'text-violet-500', bg: 'bg-violet-50' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`${s.bg} w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1`}>
                  <s.icon size={14} className={s.color} />
                </div>
                <p className="text-sm font-bold text-gray-900">{s.count}<span className="text-[10px] font-normal text-gray-400">건</span></p>
                <p className="text-[9px] text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
        </>
      );

    case 'shortcuts':
      return (
        <div className="grid grid-cols-4 gap-y-3 gap-x-2">
          {quickModules.map(m => (
            <button key={m.label} onClick={() => navigate(m.to)} className="flex flex-col items-center gap-1 group">
              <div className={`${m.color} w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 group-hover:shadow-md transition-all`}>
                <m.icon size={18} className="text-white" />
              </div>
              <span className="text-[10px] text-gray-600 group-hover:text-gray-900 font-medium">{m.label}</span>
            </button>
          ))}
        </div>
      );

    case 'calendar':
      return <MiniCalendar />;

    case 'approval':
      return (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            {[{ label: '전체', count: 0, active: true }, { label: '대기', count: 0 }, { label: '확인', count: 0 }, { label: '예정', count: 0 }, { label: '진행', count: 0 }].map(t => (
              <span key={t.label} className={`text-xs px-3 py-1.5 rounded-full font-medium ${t.active ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'} cursor-pointer transition-colors`}>
                {t.label} {t.count}
              </span>
            ))}
          </div>
          <div className="text-center py-6 text-gray-300">
            <FileCheck size={28} className="mx-auto mb-2" />
            <p className="text-sm text-gray-400">기안된 문서가 없습니다</p>
          </div>
        </>
      );

    case 'taskorders':
      return (
        <>
          <div className="flex gap-3 mb-4">
            {[
              { icon: AlertCircle, label: '대기', count: 0, color: 'text-orange-500', bg: 'bg-orange-50' },
              { icon: Timer, label: '진행중', count: 0, color: 'text-primary-600', bg: 'bg-primary-50' },
              { icon: CheckCircle2, label: '완료', count: 0, color: 'text-emerald-500', bg: 'bg-emerald-50' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} flex-1 rounded-2xl p-3 text-center`}>
                <s.icon size={16} className={`${s.color} mx-auto mb-1`} />
                <p className="text-lg font-bold text-gray-800">{s.count}</p>
                <p className="text-[10px] text-gray-500">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="text-center py-3 text-gray-300">
            <p className="text-sm text-gray-400">작업지시서가 없습니다</p>
          </div>
        </>
      );

    case 'board':
      return (
        <div className="text-center py-6 text-gray-300">
          <Newspaper size={28} className="mx-auto mb-2" />
          <p className="text-sm text-gray-400">게시글이 없습니다</p>
        </div>
      );

    case 'attendance':
      return (
        <>
          <div className="text-center mb-3">
            <span className={`inline-block text-xs px-3 py-1 rounded-full font-medium mb-2 ${checkedIn ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
              {checkedIn ? '출근중' : '미출근'}
            </span>
            <p className="text-2xl font-mono font-bold text-gray-900 tracking-wider">{timeStr}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{dateStr}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setCheckedIn(true)} disabled={checkedIn} className={`py-2 rounded-2xl text-sm font-medium transition-all ${checkedIn ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm'}`}>출근</button>
            <button onClick={() => setCheckedIn(false)} disabled={!checkedIn} className={`py-2 rounded-2xl text-sm font-medium transition-all ${!checkedIn ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600 shadow-sm'}`}>퇴근</button>
          </div>
        </>
      );

    case 'memo':
      return (
        <textarea
          value={memo}
          onChange={e => setMemo(e.target.value)}
          placeholder="메모를 입력하세요..."
          className="w-full h-full bg-transparent text-sm text-gray-700 placeholder:text-gray-400 resize-none focus:outline-none"
        />
      );

    case 'cctv':
      return (
        <div className="grid grid-cols-2 gap-1.5 h-full">
          {[1, 2, 3, 4].map(ch => (
            <div key={ch} className="bg-gray-800 rounded-xl flex items-center justify-center min-h-[60px]">
              <p className="text-[10px] text-gray-500">빈 채널</p>
            </div>
          ))}
        </div>
      );

    case 'alerts':
      return (
        <div className="text-center py-4 text-gray-300">
          <Bell size={24} className="mx-auto mb-1.5" />
          <p className="text-xs text-gray-400">새로운 알림이 없습니다</p>
        </div>
      );

    default:
      return null;
  }
}

/* ══════════════════════════════════════════
   대시보드 메인
   ══════════════════════════════════════════ */
export default function DashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const now = useClock();
  const [memo, setMemo] = useState('');
  const [checkedIn, setCheckedIn] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch { return []; }
  });
  const [layouts, setLayouts] = useState<Layouts>(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      return saved ? JSON.parse(saved) : getDefaultLayouts();
    } catch { return getDefaultLayouts(); }
  });
  const [showAddPanel, setShowAddPanel] = useState(false);
  const { containerRef, width: containerWidth } = useContainerWidth();

  const saveLayouts = useCallback((newLayouts: Layouts) => {
    setLayouts(newLayouts);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(newLayouts));
  }, []);

  const saveHidden = useCallback((ids: string[]) => {
    setHiddenWidgets(ids);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  }, []);

  const resetLayout = () => {
    const defaults = getDefaultLayouts();
    saveLayouts(defaults);
    saveHidden([]);
    setShowAddPanel(false);
  };

  const hideWidget = (id: string) => {
    saveHidden([...hiddenWidgets, id]);
  };

  const showWidget = (id: string) => {
    const newHidden = hiddenWidgets.filter(h => h !== id);
    saveHidden(newHidden);
    // 새 위젯의 위치 추가
    const def = WIDGET_DEFS.find(w => w.id === id);
    if (def) {
      const newLayouts = { ...layouts };
      for (const bp of Object.keys(newLayouts)) {
        const existing = newLayouts[bp].find(l => l.i === id);
        if (!existing) {
          newLayouts[bp] = [...newLayouts[bp], { i: id, x: 0, y: Infinity, w: def.defaultW, h: def.defaultH }];
        }
      }
      saveLayouts(newLayouts);
    }
  };

  const visibleWidgets = useMemo(
    () => WIDGET_DEFS.filter(w => !hiddenWidgets.includes(w.id)),
    [hiddenWidgets]
  );

  const hiddenDefs = useMemo(
    () => WIDGET_DEFS.filter(w => hiddenWidgets.includes(w.id)),
    [hiddenWidgets]
  );

  // 각 위젯의 linkTo
  const widgetLinks: Record<string, string> = {
    approval: '/approval',
    taskorders: '/task-orders',
    board: '/board',
    attendance: '/attendance',
    cctv: '/cctv',
    calendar: '/calendar',
  };

  return (
    <div className="p-4 lg:p-6">
      {/* ── 상단 툴바 ── */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-800">대시보드</h1>
        <div className="flex items-center gap-2">
          {editing && (
            <>
              <button
                onClick={() => setShowAddPanel(!showAddPanel)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <Plus size={14} /> 위젯 추가
              </button>
              <button
                onClick={resetLayout}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
              >
                <RotateCcw size={14} /> 초기화
              </button>
            </>
          )}
          <button
            onClick={() => { setEditing(!editing); setShowAddPanel(false); }}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-xl transition-all ${
              editing
                ? 'bg-primary-500 text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {editing ? <><CheckCircle2 size={14} /> 완료</> : <><Pencil size={14} /> 편집</>}
          </button>
        </div>
      </div>

      {/* ── 위젯 추가 패널 ── */}
      {editing && showAddPanel && hiddenDefs.length > 0 && (
        <div className="mb-4 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <p className="text-xs font-medium text-gray-500 mb-3">숨겨진 위젯 — 클릭하여 추가</p>
          <div className="flex flex-wrap gap-2">
            {hiddenDefs.map(w => (
              <button
                key={w.id}
                onClick={() => showWidget(w.id)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-primary-50 border border-gray-200 hover:border-primary-300 rounded-xl text-sm transition-colors"
              >
                <w.icon size={14} className={w.iconColor} />
                <span className="text-gray-700">{w.title}</span>
                <Plus size={12} className="text-gray-400" />
              </button>
            ))}
          </div>
        </div>
      )}
      {editing && showAddPanel && hiddenDefs.length === 0 && (
        <div className="mb-4 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm">
          <p className="text-xs text-gray-400 text-center">모든 위젯이 표시 중입니다</p>
        </div>
      )}

      {/* ── 그리드 레이아웃 ── */}
      <div ref={containerRef}>
      <Responsive
        className="layout"
        width={containerWidth ?? 1200}
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
        rowHeight={40}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".widget-drag-handle"
        onLayoutChange={(_, allLayouts) => saveLayouts(allLayouts)}
        compactType="vertical"
        margin={[16, 16]}
      >
        {visibleWidgets.map(w => {
          const isMemo = w.id === 'memo';
          return (
            <div
              key={w.id}
              data-grid={{
                minW: w.minW,
                minH: w.minH,
              }}
              className={`${isMemo ? 'bg-primary-100/60 border-primary-200/50' : 'bg-white border-gray-100/80'} rounded-3xl shadow-sm border overflow-hidden flex flex-col ${editing ? 'ring-2 ring-primary-200/50' : ''}`}
            >
              {/* 위젯 헤더 */}
              <div className={`flex items-center justify-between px-4 pt-3 pb-1 ${editing ? 'widget-drag-handle cursor-grab active:cursor-grabbing' : ''}`}>
                <div className="flex items-center gap-2">
                  {editing && <GripVertical size={14} className="text-gray-300" />}
                  <w.icon size={14} className={w.iconColor} />
                  <h3 className="font-semibold text-sm text-gray-800">{w.title}</h3>
                </div>
                <div className="flex items-center gap-1">
                  {!editing && widgetLinks[w.id] && (
                    <button onClick={() => navigate(widgetLinks[w.id])} className="text-xs text-gray-400 hover:text-primary-500 flex items-center gap-0.5">
                      더보기 <ArrowRight size={12} />
                    </button>
                  )}
                  {editing && (
                    <button onClick={() => hideWidget(w.id)} className="p-1 hover:bg-red-50 rounded-lg transition-colors" title="위젯 숨기기">
                      <X size={14} className="text-gray-400 hover:text-red-500" />
                    </button>
                  )}
                </div>
              </div>
              {/* 위젯 콘텐츠 */}
              <div className={`flex-1 overflow-auto px-4 pb-4 ${isMemo ? 'pt-1' : 'pt-2'}`}>
                <WidgetContent
                  id={w.id}
                  navigate={navigate}
                  user={user}
                  now={now}
                  memo={memo}
                  setMemo={setMemo}
                  checkedIn={checkedIn}
                  setCheckedIn={setCheckedIn}
                />
              </div>
            </div>
          );
        })}
      </Responsive>
      </div>
    </div>
  );
}
