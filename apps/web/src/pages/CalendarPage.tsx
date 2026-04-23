/**
 * 캘린더 페이지 (v0.21.0)
 *
 * 월간 뷰 기반 + 전면 기능 확장:
 *   - 드래그 다중선택으로 장기 일정 생성
 *   - 이벤트 칩 드래그로 **다른 날짜로 이동** (duration 유지)
 *   - 다중일 이벤트의 끝 날짜 셀 우측 드래그로 **기간 연장** (리사이즈)
 *   - 카테고리(색·이름) CRUD + 사이드바 필터
 *   - 반복 일정 (일/주/월/년) + 반복 종료일 + 클라이언트 expand
 *   - 참석자 초대 (사용자 검색 autocomplete)
 *   - 월/주/일 뷰 전환
 *
 * 백엔드:
 *   GET/POST/PATCH/DELETE /calendar/events
 *   GET/POST/PATCH/DELETE /calendar/categories
 *   GET /users?search= (참석자 검색)
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Clock, MapPin,
  Trash2, Edit2, Tag, Check, Save, Users, Repeat, LayoutGrid, Columns, Square,
} from 'lucide-react';
import api from '../services/api';

interface CalendarCategory {
  id: string; name: string; color: string;
  ownerId: string | null; isDefault: boolean; sortOrder: number;
}

type RepeatKind = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

interface CalendarEvent {
  id: string; title: string; description?: string;
  startDate: string; endDate: string;
  allDay: boolean; location?: string; color?: string;
  categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
  repeat: RepeatKind;
  repeatUntil?: string | null;
  scope: 'personal' | 'department' | 'company';
  creator: { id: string; name: string };
  attendees: { user: { id: string; name: string } }[];
}

interface UserLite { id: string; name: string; employeeId: string; department?: { name?: string | null } | null }

type ViewMode = 'month' | 'week' | 'day';
type FormMode = 'create' | 'edit';

interface EventFormState {
  id?: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location: string;
  categoryId: string;
  color: string;
  repeat: RepeatKind;
  repeatUntil: string;
  scope: 'personal' | 'department' | 'company';
  attendeeIds: string[];
  attendeePreview: UserLite[]; // 모달 내 선택 표시용
}

const COLOR_PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#6b7280',
];

const SCOPE_LABEL: Record<string, string> = { personal: '개인', department: '부서', company: '전사' };
const REPEAT_LABEL: Record<RepeatKind, string> = {
  none: '반복 없음', daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년',
};

// ─────────────────── 메인 ───────────────────

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  const [hiddenCatIds, setHiddenCatIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('po-cal-hidden-cats') || '[]')); } catch { return new Set(); }
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('po-cal-view') as ViewMode) || 'month';
  });
  const [currentDate, setCurrentDate] = useState(new Date());

  // 드래그 상태 (3종 중 하나만)
  const [rangeSelect, setRangeSelect] = useState<{ start: Date; current: Date } | null>(null);
  const [movingEvent, setMovingEvent] = useState<{ eventId: string; originalStart: Date; originalEnd: Date; targetDate: Date | null } | null>(null);
  const [resizingEvent, setResizingEvent] = useState<{ eventId: string; originalEnd: Date; targetDate: Date | null } | null>(null);
  const mouseMovedRef = useRef(false);

  // 모달
  const [eventForm, setEventForm] = useState<{ mode: FormMode; open: boolean; form: EventFormState } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // ── 뷰 범위 계산 ──
  const viewRange = useMemo(() => {
    if (viewMode === 'month') {
      const y = currentDate.getFullYear(), m = currentDate.getMonth();
      return {
        start: new Date(y, m - 1, 20), // 이전달 말 포함
        end: new Date(y, m + 2, 10),   // 다음달 초 포함
      };
    }
    if (viewMode === 'week') {
      const d = new Date(currentDate); d.setHours(0, 0, 0, 0);
      const startOfWeek = new Date(d); startOfWeek.setDate(d.getDate() - d.getDay()); // Sun
      const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23, 59, 59, 999);
      return { start: startOfWeek, end: endOfWeek };
    }
    const d = new Date(currentDate); d.setHours(0, 0, 0, 0);
    const e = new Date(d); e.setHours(23, 59, 59, 999);
    return { start: d, end: e };
  }, [viewMode, currentDate]);

  // ── API ──
  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get(`/calendar/events?start=${viewRange.start.toISOString()}&end=${viewRange.end.toISOString()}`);
      setEvents(res.data.data || []);
    } catch { /* ignore */ }
  }, [viewRange]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/calendar/categories');
      setCategories(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => { localStorage.setItem('po-cal-hidden-cats', JSON.stringify(Array.from(hiddenCatIds))); }, [hiddenCatIds]);
  useEffect(() => { localStorage.setItem('po-cal-view', viewMode); }, [viewMode]);

  // ── 반복 이벤트 expand (클라이언트) ──
  const expandedEvents = useMemo(() => {
    return expandRepeatedEvents(events, viewRange.start, viewRange.end);
  }, [events, viewRange]);

  const visibleEvents = useMemo(() => {
    return expandedEvents.filter((e) => {
      const catId = e.category?.id ?? e.categoryId ?? '__uncategorized__';
      if (catId === '__uncategorized__') return !hiddenCatIds.has('__uncategorized__');
      return !hiddenCatIds.has(catId);
    });
  }, [expandedEvents, hiddenCatIds]);

  // ── 네비게이션 ──
  const goPrev = () => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() - 1);
    else if (viewMode === 'week') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };
  const goNext = () => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + 1);
    else if (viewMode === 'week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };
  const goToday = () => setCurrentDate(new Date());

  const headerTitle = useMemo(() => {
    if (viewMode === 'month') return `${currentDate.getFullYear()}년 ${currentDate.getMonth() + 1}월`;
    if (viewMode === 'week') {
      const { start, end } = viewRange;
      return `${start.getMonth() + 1}.${start.getDate()} ~ ${end.getMonth() + 1}.${end.getDate()}`;
    }
    return currentDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  }, [viewMode, currentDate, viewRange]);

  // ── 드래그 전역 mouseup ──
  const handleGlobalMouseUp = useCallback(async () => {
    // 1. 범위 선택 종료 → 생성 모달
    if (rangeSelect) {
      const [s, e] = [rangeSelect.start, rangeSelect.current].sort((a, b) => a.getTime() - b.getTime());
      const defaultCat = categories.find((c) => c.isDefault) || categories[0];
      openCreateForm({
        startDate: toLocalInput(s, 9, 0),
        endDate: toLocalInput(e, 18, 0),
        allDay: s.toDateString() !== e.toDateString(),
        categoryId: defaultCat?.id || '',
        color: defaultCat?.color || '#3b82f6',
      });
      setRangeSelect(null);
      return;
    }
    // 2. 이벤트 이동 커밋
    if (movingEvent && movingEvent.targetDate) {
      const delta = movingEvent.targetDate.getTime() - toDayStart(movingEvent.originalStart).getTime();
      if (delta !== 0) {
        const newStart = new Date(movingEvent.originalStart.getTime() + delta);
        const newEnd = new Date(movingEvent.originalEnd.getTime() + delta);
        try {
          await api.patch(`/calendar/events/${movingEvent.eventId}`, {
            startDate: newStart.toISOString(),
            endDate: newEnd.toISOString(),
          });
          fetchEvents();
        } catch { /* ignore */ }
      }
      setMovingEvent(null);
      return;
    }
    // 3. 리사이즈 커밋
    if (resizingEvent && resizingEvent.targetDate) {
      const newEnd = new Date(resizingEvent.targetDate);
      newEnd.setHours(23, 59, 59, 999);
      if (newEnd.getTime() !== resizingEvent.originalEnd.getTime()) {
        try {
          await api.patch(`/calendar/events/${resizingEvent.eventId}`, {
            endDate: newEnd.toISOString(),
          });
          fetchEvents();
        } catch { /* ignore */ }
      }
      setResizingEvent(null);
      return;
    }
  }, [rangeSelect, movingEvent, resizingEvent, categories, fetchEvents]);

  useEffect(() => {
    if (rangeSelect || movingEvent || resizingEvent) {
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [rangeSelect, movingEvent, resizingEvent, handleGlobalMouseUp]);

  // ── 셀 인터랙션 ──
  const handleCellMouseDown = (date: Date, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
    if ((e.target as HTMLElement).closest('[data-resize-handle]')) return;
    mouseMovedRef.current = false;
    setRangeSelect({ start: date, current: date });
  };
  const handleCellMouseEnter = (date: Date) => {
    if (rangeSelect) {
      if (rangeSelect.current.getTime() !== date.getTime()) {
        mouseMovedRef.current = true;
        setRangeSelect({ ...rangeSelect, current: date });
      }
    }
    if (movingEvent) setMovingEvent({ ...movingEvent, targetDate: date });
    if (resizingEvent) setResizingEvent({ ...resizingEvent, targetDate: date });
  };
  const handleCellClick = (date: Date) => {
    if (rangeSelect && !mouseMovedRef.current) {
      // 단일 클릭 (이동 없음) — 생성 모달
      const defaultCat = categories.find((c) => c.isDefault) || categories[0];
      openCreateForm({
        startDate: toLocalInput(date, 9, 0),
        endDate: toLocalInput(date, 10, 0),
        allDay: false,
        categoryId: defaultCat?.id || '',
        color: defaultCat?.color || '#3b82f6',
      });
      setRangeSelect(null);
    }
  };

  const handleEventMouseDown = (ev: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    mouseMovedRef.current = false;
    setMovingEvent({
      eventId: ev.id,
      originalStart: new Date(ev.startDate),
      originalEnd: new Date(ev.endDate),
      targetDate: null,
    });
  };
  const handleEventClick = (ev: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mouseMovedRef.current) setSelectedEvent(ev);
  };
  const handleResizeMouseDown = (ev: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    mouseMovedRef.current = false;
    setResizingEvent({
      eventId: ev.id,
      originalEnd: new Date(ev.endDate),
      targetDate: null,
    });
  };

  const isInSelectRange = (date: Date) => {
    if (!rangeSelect) return false;
    const [s, e] = [rangeSelect.start.getTime(), rangeSelect.current.getTime()].sort((a, b) => a - b);
    const t = toDayStart(date).getTime();
    return t >= toDayStart(new Date(s)).getTime() && t <= toDayStart(new Date(e)).getTime();
  };

  // ── Form helpers ──
  const emptyForm = (partial: Partial<EventFormState> = {}): EventFormState => {
    const defaultCat = categories.find((c) => c.isDefault) || categories[0];
    const now = new Date();
    return {
      title: '',
      description: '',
      startDate: partial.startDate ?? toLocalInput(now, 9, 0),
      endDate: partial.endDate ?? toLocalInput(now, 10, 0),
      allDay: partial.allDay ?? false,
      location: '',
      categoryId: partial.categoryId ?? defaultCat?.id ?? '',
      color: partial.color ?? defaultCat?.color ?? '#3b82f6',
      repeat: 'none',
      repeatUntil: '',
      scope: 'personal',
      attendeeIds: [],
      attendeePreview: [],
    };
  };

  const openCreateForm = (partial: Partial<EventFormState> = {}) => {
    setEventForm({ mode: 'create', open: true, form: emptyForm(partial) });
    setSelectedEvent(null);
  };

  const openEditForm = (ev: CalendarEvent) => {
    setEventForm({
      mode: 'edit',
      open: true,
      form: {
        id: ev.id,
        title: ev.title,
        description: ev.description || '',
        startDate: toLocalInput(new Date(ev.startDate)),
        endDate: toLocalInput(new Date(ev.endDate)),
        allDay: ev.allDay,
        location: ev.location || '',
        categoryId: ev.categoryId || ev.category?.id || '',
        color: ev.color || ev.category?.color || '#3b82f6',
        repeat: ev.repeat || 'none',
        repeatUntil: ev.repeatUntil ? ev.repeatUntil.slice(0, 10) : '',
        scope: ev.scope,
        attendeeIds: ev.attendees?.map((a) => a.user.id) ?? [],
        attendeePreview: ev.attendees?.map((a) => ({
          id: a.user.id, name: a.user.name, employeeId: '',
        })) ?? [],
      },
    });
    setSelectedEvent(null);
  };

  const handleSaveEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!eventForm) return;
    const f = eventForm.form;
    const payload = {
      title: f.title,
      description: f.description || undefined,
      startDate: new Date(f.startDate).toISOString(),
      endDate: new Date(f.endDate).toISOString(),
      allDay: f.allDay,
      location: f.location || undefined,
      categoryId: f.categoryId || null,
      color: f.color,
      repeat: f.repeat,
      repeatUntil: f.repeat !== 'none' && f.repeatUntil
        ? new Date(`${f.repeatUntil}T23:59:59`).toISOString()
        : null,
      scope: f.scope,
      attendeeIds: f.attendeeIds,
    };
    try {
      if (eventForm.mode === 'create') {
        await api.post('/calendar/events', payload);
      } else if (f.id) {
        await api.patch(`/calendar/events/${f.id}`, payload);
      }
      setEventForm(null);
      fetchEvents();
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e2.response?.data?.error?.message || '저장 실패');
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('이 일정을 삭제할까요?')) return;
    try {
      await api.delete(`/calendar/events/${id}`);
      setSelectedEvent(null);
      setEventForm(null);
      fetchEvents();
    } catch { alert('삭제 실패'); }
  };

  const toggleCategoryFilter = (id: string) => {
    setHiddenCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 md:p-6 flex gap-4">
      {/* ─── 좌측 사이드바 ─── */}
      <aside className="w-56 shrink-0 space-y-4">
        <button onClick={() => openCreateForm()} className="btn-primary w-full flex items-center justify-center gap-1.5">
          <Plus size={16} /> 일정 추가
        </button>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <Tag size={14} /> 카테고리
            </h3>
            <button onClick={() => setShowCategoryManager(true)} className="text-xs text-primary-600 hover:underline">관리</button>
          </div>
          <div className="space-y-1">
            {categories.map((cat) => {
              const hidden = hiddenCatIds.has(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategoryFilter(cat.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 ${hidden ? 'opacity-40' : ''}`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-offset-1 dark:ring-offset-slate-800"
                    style={{ backgroundColor: cat.color, '--tw-ring-color': cat.color } as React.CSSProperties}
                  />
                  <span className={`text-sm truncate flex-1 text-left ${cat.isDefault ? 'font-medium' : ''}`}>{cat.name}</span>
                  {!hidden && <Check size={12} className="text-primary-500 shrink-0" />}
                </button>
              );
            })}
            <button
              onClick={() => toggleCategoryFilter('__uncategorized__')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 ${hiddenCatIds.has('__uncategorized__') ? 'opacity-40' : ''}`}
            >
              <span className="w-3.5 h-3.5 rounded-full border border-dashed border-gray-400 shrink-0" />
              <span className="text-sm truncate flex-1 text-left text-gray-500">(미분류)</span>
              {!hiddenCatIds.has('__uncategorized__') && <Check size={12} className="text-primary-500 shrink-0" />}
            </button>
          </div>
        </div>

        <div className="bg-primary-50 dark:bg-slate-800 border border-primary-200 dark:border-slate-700 rounded-2xl p-3 text-xs text-gray-700 dark:text-gray-300 space-y-1">
          <p><strong>💡 사용법</strong></p>
          <p>• 셀 클릭 → 일정 추가</p>
          <p>• 드래그 → 장기 일정</p>
          <p>• 일정 드래그 → 날짜 이동</p>
          <p>• 우측 ↕ 핸들 → 기간 연장</p>
        </div>
      </aside>

      {/* ─── 우측 메인 ─── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button onClick={goPrev} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon size={24} className="text-primary-600" />
              {headerTitle}
            </h1>
            <button onClick={goNext} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* 뷰 전환 */}
            <div className="flex bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5">
              <ViewBtn active={viewMode === 'month'} onClick={() => setViewMode('month')} icon={<LayoutGrid size={14} />} label="월" />
              <ViewBtn active={viewMode === 'week'} onClick={() => setViewMode('week')} icon={<Columns size={14} />} label="주" />
              <ViewBtn active={viewMode === 'day'} onClick={() => setViewMode('day')} icon={<Square size={14} />} label="일" />
            </div>
            <button onClick={goToday} className="btn-secondary text-sm">오늘</button>
          </div>
        </div>

        {viewMode === 'month' && (
          <MonthView
            currentDate={currentDate}
            events={visibleEvents}
            onCellMouseDown={handleCellMouseDown}
            onCellMouseEnter={handleCellMouseEnter}
            onCellClick={handleCellClick}
            onEventMouseDown={handleEventMouseDown}
            onEventClick={handleEventClick}
            onResizeMouseDown={handleResizeMouseDown}
            isInSelectRange={isInSelectRange}
            movingEventId={movingEvent?.eventId}
            resizingEventId={resizingEvent?.eventId}
          />
        )}
        {viewMode === 'week' && (
          <TimeGridView
            range={viewRange}
            events={visibleEvents}
            days={7}
            onCellClick={(date, hour) => {
              const d = new Date(date); d.setHours(hour, 0, 0, 0);
              const e = new Date(d); e.setHours(hour + 1, 0, 0, 0);
              openCreateForm({
                startDate: toLocalInput(d), endDate: toLocalInput(e), allDay: false,
              });
            }}
            onEventClick={(ev) => setSelectedEvent(ev)}
          />
        )}
        {viewMode === 'day' && (
          <TimeGridView
            range={viewRange}
            events={visibleEvents}
            days={1}
            onCellClick={(date, hour) => {
              const d = new Date(date); d.setHours(hour, 0, 0, 0);
              const e = new Date(d); e.setHours(hour + 1, 0, 0, 0);
              openCreateForm({
                startDate: toLocalInput(d), endDate: toLocalInput(e), allDay: false,
              });
            }}
            onEventClick={(ev) => setSelectedEvent(ev)}
          />
        )}
      </div>

      {/* ─── 모달 ─── */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => openEditForm(selectedEvent)}
          onDelete={() => handleDeleteEvent(selectedEvent.id)}
        />
      )}
      {eventForm?.open && (
        <EventFormModal
          mode={eventForm.mode}
          form={eventForm.form}
          categories={categories}
          onChange={(form) => setEventForm({ ...eventForm, form })}
          onSubmit={handleSaveEvent}
          onClose={() => setEventForm(null)}
          onDelete={eventForm.mode === 'edit' && eventForm.form.id ? () => handleDeleteEvent(eventForm.form.id!) : undefined}
        />
      )}
      {showCategoryManager && (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setShowCategoryManager(false)}
          onChanged={fetchCategories}
        />
      )}
    </div>
  );
}

// ─────────────────── 월간 뷰 ───────────────────

function MonthView({
  currentDate, events, onCellMouseDown, onCellMouseEnter, onCellClick,
  onEventMouseDown, onEventClick, onResizeMouseDown,
  isInSelectRange, movingEventId, resizingEventId,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  onCellMouseDown: (d: Date, e: React.MouseEvent) => void;
  onCellMouseEnter: (d: Date) => void;
  onCellClick: (d: Date) => void;
  onEventMouseDown: (ev: CalendarEvent, e: React.MouseEvent) => void;
  onEventClick: (ev: CalendarEvent, e: React.MouseEvent) => void;
  onResizeMouseDown: (ev: CalendarEvent, e: React.MouseEvent) => void;
  isInSelectRange: (d: Date) => boolean;
  movingEventId?: string;
  resizingEventId?: string;
}) {
  const y = currentDate.getFullYear(), m = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(y, m, 1).getDay();
    const lastDate = new Date(y, m + 1, 0).getDate();
    const prevLastDate = new Date(y, m, 0).getDate();
    const days: { date: number; month: 'prev' | 'current' | 'next'; fullDate: Date }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) days.push({ date: prevLastDate - i, month: 'prev', fullDate: new Date(y, m - 1, prevLastDate - i) });
    for (let i = 1; i <= lastDate; i++) days.push({ date: i, month: 'current', fullDate: new Date(y, m, i) });
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: i, month: 'next', fullDate: new Date(y, m + 1, i) });
    return days;
  }, [y, m]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const s = toDayStart(new Date(e.startDate));
      const en = toDayStart(new Date(e.endDate));
      const cursor = new Date(s);
      while (cursor <= en) {
        const key = dateKey(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [events]);

  const today = new Date();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden select-none">
      <div className="grid grid-cols-7 bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700">
        {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
          <div key={d} className={`text-center text-xs font-semibold py-2 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600 dark:text-gray-400'}`}>
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {calendarDays.map((day, idx) => {
          const key = dateKey(day.fullDate);
          const dayEvents = eventsByDate.get(key) || [];
          const isOther = day.month !== 'current';
          const selected = isInSelectRange(day.fullDate);
          const dow = idx % 7;
          return (
            <div
              key={idx}
              onMouseDown={(e) => onCellMouseDown(day.fullDate, e)}
              onMouseEnter={() => onCellMouseEnter(day.fullDate)}
              onClick={() => onCellClick(day.fullDate)}
              className={`
                min-h-[110px] border-r border-b border-gray-200 dark:border-slate-700 last:border-r-0 p-1.5 cursor-pointer
                ${isOther ? 'bg-gray-50/60 dark:bg-slate-900/40' : ''}
                ${isToday(day.fullDate) ? 'bg-primary-50/60 dark:bg-primary-900/20' : ''}
                ${selected ? 'bg-primary-200/60 dark:bg-primary-700/30 ring-2 ring-inset ring-primary-500' : ''}
                ${!isOther && !isToday(day.fullDate) && !selected ? 'hover:bg-gray-50 dark:hover:bg-slate-700/40' : ''}
              `}
            >
              <div className={`text-xs font-semibold mb-1 px-1
                ${isOther ? 'text-gray-400 dark:text-gray-600' : ''}
                ${isToday(day.fullDate) ? 'text-primary-700 dark:text-primary-300' : ''}
                ${!isOther && !isToday(day.fullDate) && dow === 0 ? 'text-red-500' : ''}
                ${!isOther && !isToday(day.fullDate) && dow === 6 ? 'text-blue-500' : ''}
              `}>
                {day.date}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((ev, i) => {
                  const color = ev.color || ev.category?.color || '#6b7280';
                  const isMoving = movingEventId === ev.id;
                  const isResizing = resizingEventId === ev.id;
                  // 이벤트의 마지막 표시일 여부 (리사이즈 핸들 표시 용)
                  const endKey = dateKey(toDayStart(new Date(ev.endDate)));
                  const isLastDay = endKey === key;
                  return (
                    <div
                      key={`${ev.id}-${i}`}
                      data-event-chip
                      onMouseDown={(e) => onEventMouseDown(ev, e)}
                      onClick={(e) => onEventClick(ev, e)}
                      className={`
                        relative text-[11px] px-1.5 py-0.5 rounded truncate text-white cursor-grab active:cursor-grabbing
                        font-medium transition-opacity group/ev
                        ${isMoving || isResizing ? 'opacity-50' : 'hover:opacity-85'}
                      `}
                      style={{ backgroundColor: color }}
                      title={`${ev.title}${ev.category ? ` · ${ev.category.name}` : ''}`}
                    >
                      {ev.repeat !== 'none' && <Repeat size={8} className="inline mr-0.5 opacity-70" />}
                      {ev.title}
                      {isLastDay && (
                        <span
                          data-resize-handle
                          onMouseDown={(e) => onResizeMouseDown(ev, e)}
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover/ev:opacity-100 bg-white/30 hover:bg-white/60 rounded-r"
                          title="드래그로 기간 연장"
                        />
                      )}
                    </div>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-gray-400 px-1">+{dayEvents.length - 3}건</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────── 주/일간 시간 그리드 ───────────────────

function TimeGridView({
  range, events, days, onCellClick, onEventClick,
}: {
  range: { start: Date; end: Date };
  events: CalendarEvent[];
  days: 1 | 7;
  onCellClick: (date: Date, hour: number) => void;
  onEventClick: (ev: CalendarEvent) => void;
}) {
  const dayList = useMemo(() => {
    const arr: Date[] = [];
    const d = new Date(range.start);
    for (let i = 0; i < days; i++) {
      arr.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return arr;
  }, [range.start, days]);

  const hours = Array.from({ length: 24 }, (_, h) => h);

  const today = new Date();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  // 각 날짜 × 시간대별 이벤트 (시간 지정)
  const eventsByHour = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (e.allDay) continue;
      const start = new Date(e.startDate);
      const end = new Date(e.endDate);
      // 표시 범위 내 각 "시작 시간 슬롯"
      const cursor = new Date(start);
      while (cursor < end) {
        const key = `${dateKey(cursor)}-${cursor.getHours()}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        cursor.setHours(cursor.getHours() + 1);
      }
    }
    return map;
  }, [events]);

  // 전일 이벤트는 상단 밴드에
  const allDayByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!e.allDay) continue;
      const s = toDayStart(new Date(e.startDate));
      const en = toDayStart(new Date(e.endDate));
      const cursor = new Date(s);
      while (cursor <= en) {
        const key = dateKey(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [events]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[70vh]">
      {/* 헤더 */}
      <div
        className="grid bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700"
        style={{ gridTemplateColumns: `60px repeat(${days}, 1fr)` }}
      >
        <div />
        {dayList.map((d, i) => (
          <div
            key={i}
            className={`text-center py-2 border-l border-gray-200 dark:border-slate-700 ${
              isToday(d) ? 'bg-primary-50 dark:bg-primary-900/30' : ''
            }`}
          >
            <div className={`text-xs font-semibold ${
              d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-gray-600 dark:text-gray-400'
            }`}>{['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}</div>
            <div className={`text-lg font-bold ${
              isToday(d) ? 'text-primary-600' : 'text-gray-800 dark:text-gray-200'
            }`}>{d.getDate()}</div>
          </div>
        ))}
      </div>

      {/* 전일 이벤트 밴드 */}
      <div
        className="grid border-b border-gray-200 dark:border-slate-700"
        style={{ gridTemplateColumns: `60px repeat(${days}, 1fr)` }}
      >
        <div className="text-[10px] text-gray-400 text-center py-1 flex items-center justify-center">종일</div>
        {dayList.map((d, i) => {
          const all = allDayByDate.get(dateKey(d)) || [];
          return (
            <div key={i} className="border-l border-gray-200 dark:border-slate-700 min-h-[28px] p-0.5 space-y-0.5">
              {all.map((ev, j) => {
                const color = ev.color || ev.category?.color || '#6b7280';
                return (
                  <div
                    key={`${ev.id}-${j}`}
                    onClick={() => onEventClick(ev)}
                    className="text-[10px] px-1 py-0.5 rounded truncate text-white cursor-pointer hover:opacity-85"
                    style={{ backgroundColor: color }}
                    title={ev.title}
                  >
                    {ev.title}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 시간대 그리드 */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ gridTemplateColumns: `60px repeat(${days}, 1fr)` }}
        >
          {hours.map((hour) => (
            <>
              <div
                key={`h-${hour}`}
                className="text-[10px] text-gray-400 text-right pr-2 pt-1 border-b border-gray-100 dark:border-slate-700 h-12"
              >
                {String(hour).padStart(2, '0')}:00
              </div>
              {dayList.map((d, i) => {
                const key = `${dateKey(d)}-${hour}`;
                const list = eventsByHour.get(key) || [];
                return (
                  <div
                    key={`c-${hour}-${i}`}
                    onClick={() => onCellClick(d, hour)}
                    className={`border-l border-b border-gray-100 dark:border-slate-700 h-12 p-0.5 cursor-pointer hover:bg-primary-50/40 dark:hover:bg-slate-700/40 relative space-y-0.5 overflow-hidden`}
                  >
                    {list.map((ev, j) => {
                      const color = ev.color || ev.category?.color || '#6b7280';
                      return (
                        <div
                          key={`${ev.id}-${j}`}
                          onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                          className="text-[10px] px-1 py-0.5 rounded text-white truncate cursor-pointer hover:opacity-85"
                          style={{ backgroundColor: color }}
                          title={ev.title}
                        >
                          {new Date(ev.startDate).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} {ev.title}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────── 모달 — 상세 ───────────────────

function EventDetailModal({
  event, onClose, onEdit, onDelete,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = event.color || event.category?.color || '#6b7280';
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <h3 className="font-bold truncate">{event.title}</h3>
          </div>
          <div className="flex gap-1">
            <button onClick={onEdit} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded" title="편집"><Edit2 size={14} /></button>
            <button onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="삭제"><Trash2 size={14} /></button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><X size={14} /></button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          {event.category && (
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{event.category.name}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Clock size={14} className="text-gray-400 mt-0.5 shrink-0" />
            <div className="text-gray-700 dark:text-gray-300">
              {event.allDay ? (
                <>하루 종일 · {fmtDate(event.startDate)}
                  {event.startDate.slice(0, 10) !== event.endDate.slice(0, 10) && ` ~ ${fmtDate(event.endDate)}`}
                </>
              ) : (
                <>{fmtDateTime(event.startDate)}<br />~ {fmtDateTime(event.endDate)}</>
              )}
            </div>
          </div>
          {event.repeat !== 'none' && (
            <div className="flex items-center gap-2">
              <Repeat size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">
                {REPEAT_LABEL[event.repeat]}
                {event.repeatUntil && ` · ${new Date(event.repeatUntil).toLocaleDateString('ko-KR')}까지`}
              </span>
            </div>
          )}
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{event.location}</span>
            </div>
          )}
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-start gap-2">
              <Users size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">
                {event.attendees.map((a) => a.user.name).join(', ')}
              </span>
            </div>
          )}
          {event.description && (
            <div className="pt-2 text-gray-600 dark:text-gray-400 whitespace-pre-wrap border-t border-gray-100 dark:border-slate-700">
              {event.description}
            </div>
          )}
          <div className="pt-3 text-xs text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-slate-700">
            <span>{SCOPE_LABEL[event.scope]} · {event.creator?.name ?? ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── 모달 — 생성/편집 ───────────────────

function EventFormModal({
  mode, form, categories, onChange, onSubmit, onClose, onDelete,
}: {
  mode: FormMode;
  form: EventFormState;
  categories: CalendarCategory[];
  onChange: (next: EventFormState) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const handleCategoryChange = (id: string) => {
    const cat = categories.find((c) => c.id === id);
    onChange({ ...form, categoryId: id, color: cat?.color || form.color });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h3 className="font-bold">{mode === 'create' ? '일정 추가' : '일정 편집'}</h3>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">제목 *</label>
            <input
              type="text" value={form.title}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
              required maxLength={200} autoFocus className="input-field w-full"
              placeholder="일정 제목"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">카테고리</label>
            <div className="flex gap-2">
              <select value={form.categoryId} onChange={(e) => handleCategoryChange(e.target.value)} className="input-field flex-1">
                <option value="">(미분류)</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                type="color" value={form.color}
                onChange={(e) => onChange({ ...form, color: e.target.value })}
                className="w-12 h-10 rounded-lg cursor-pointer border border-gray-300"
                title="개별 색상"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="allDay" checked={form.allDay}
              onChange={(e) => onChange({ ...form, allDay: e.target.checked })} className="w-4 h-4" />
            <label htmlFor="allDay" className="text-sm">하루 종일</label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">시작 *</label>
              <input
                type={form.allDay ? 'date' : 'datetime-local'}
                value={form.allDay ? form.startDate.slice(0, 10) : form.startDate}
                onChange={(e) => onChange({
                  ...form,
                  startDate: form.allDay ? `${e.target.value}T00:00` : e.target.value,
                })}
                required className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">종료 *</label>
              <input
                type={form.allDay ? 'date' : 'datetime-local'}
                value={form.allDay ? form.endDate.slice(0, 10) : form.endDate}
                onChange={(e) => onChange({
                  ...form,
                  endDate: form.allDay ? `${e.target.value}T23:59` : e.target.value,
                })}
                required className="input-field w-full"
              />
            </div>
          </div>

          {/* 반복 설정 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
              <Repeat size={12} /> 반복
            </label>
            <div className="flex gap-2">
              <select
                value={form.repeat}
                onChange={(e) => onChange({ ...form, repeat: e.target.value as RepeatKind })}
                className="input-field flex-1"
              >
                {(['none', 'daily', 'weekly', 'monthly', 'yearly'] as RepeatKind[]).map((r) => (
                  <option key={r} value={r}>{REPEAT_LABEL[r]}</option>
                ))}
              </select>
              {form.repeat !== 'none' && (
                <input
                  type="date"
                  value={form.repeatUntil}
                  onChange={(e) => onChange({ ...form, repeatUntil: e.target.value })}
                  className="input-field w-40"
                  title="반복 종료일 (비워두면 무제한)"
                  placeholder="종료일"
                />
              )}
            </div>
            {form.repeat !== 'none' && (
              <div className="text-[10px] text-gray-400 mt-1">반복 종료일을 비워두면 계속 반복됩니다</div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">장소</label>
            <input type="text" value={form.location}
              onChange={(e) => onChange({ ...form, location: e.target.value })}
              maxLength={200} className="input-field w-full" placeholder="회의실 A, 사무실, 온라인 등" />
          </div>

          {/* 참석자 초대 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
              <Users size={12} /> 참석자
            </label>
            <AttendeePicker
              selected={form.attendeePreview}
              onChange={(list) => onChange({
                ...form,
                attendeePreview: list,
                attendeeIds: list.map((u) => u.id),
              })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">설명</label>
            <textarea value={form.description}
              onChange={(e) => onChange({ ...form, description: e.target.value })}
              maxLength={2000} rows={3} className="input-field w-full resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">공개 범위</label>
            <select value={form.scope}
              onChange={(e) => onChange({ ...form, scope: e.target.value as EventFormState['scope'] })}
              className="input-field w-full"
            >
              <option value="personal">개인</option>
              <option value="department">부서</option>
              <option value="company">전사</option>
            </select>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-700 flex gap-2 justify-end sticky bottom-0 bg-white dark:bg-slate-800">
          {onDelete && (
            <button type="button" onClick={onDelete}
              className="btn-secondary text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 mr-auto">
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">취소</button>
          <button type="submit" className="btn-primary flex items-center gap-1.5">
            <Save size={14} /> {mode === 'create' ? '추가' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────── 참석자 Picker ───────────────────

function AttendeePicker({
  selected, onChange,
}: {
  selected: UserLite[];
  onChange: (list: UserLite[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/users?search=${encodeURIComponent(query.trim())}&limit=10`);
        setResults(data.data || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const add = (u: UserLite) => {
    if (selected.find((s) => s.id === u.id)) return;
    onChange([...selected, u]);
    setQuery('');
    setResults([]);
  };
  const remove = (id: string) => onChange(selected.filter((u) => u.id !== id));

  return (
    <div className="space-y-1.5">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <span key={u.id}
              className="bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs px-2 py-1 rounded-full flex items-center gap-1">
              {u.name}
              <button type="button" onClick={() => remove(u.id)} className="hover:text-red-500"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름, 사번, 이메일로 검색"
          className="input-field w-full"
        />
        {(results.length > 0 || loading) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto z-20">
            {loading && <div className="px-3 py-2 text-xs text-gray-400">검색 중...</div>}
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => add(u)}
                className="w-full text-left px-3 py-2 hover:bg-primary-50 dark:hover:bg-slate-700 text-sm flex items-center gap-2"
              >
                <div className="w-6 h-6 rounded-full bg-primary-200 dark:bg-primary-800 flex items-center justify-center text-xs font-semibold">
                  {u.name?.[0] || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{u.name}</div>
                  <div className="text-[10px] text-gray-400 truncate">
                    {u.employeeId}{u.department?.name ? ` · ${u.department.name}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────── 모달 — 카테고리 관리 ───────────────────

function CategoryManagerModal({
  categories, onClose, onChanged,
}: {
  categories: CalendarCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CalendarCategory | null>(null);
  const [newCat, setNewCat] = useState({ name: '', color: COLOR_PALETTE[0] });
  const [saving, setSaving] = useState(false);

  const createCategory = async () => {
    if (!newCat.name.trim()) return;
    setSaving(true);
    try {
      await api.post('/calendar/categories', { name: newCat.name.trim(), color: newCat.color });
      setNewCat({ name: '', color: COLOR_PALETTE[0] });
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '생성 실패');
    } finally { setSaving(false); }
  };

  const updateCategory = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.patch(`/calendar/categories/${editing.id}`, { name: editing.name, color: editing.color });
      setEditing(null);
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '수정 실패');
    } finally { setSaving(false); }
  };

  const deleteCategory = async (cat: CalendarCategory) => {
    if (cat.isDefault) { alert('기본 카테고리는 삭제할 수 없습니다'); return; }
    if (!confirm(`"${cat.name}" 카테고리를 삭제할까요?`)) return;
    try { await api.delete(`/calendar/categories/${cat.id}`); onChanged(); }
    catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '삭제 실패');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-1.5"><Tag size={16} /> 카테고리 관리</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-2">
          {categories.map((cat) => {
            const isEditingThis = editing?.id === cat.id;
            return (
              <div key={cat.id} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-slate-700/40 rounded-lg">
                {isEditingThis ? (
                  <>
                    <input type="color" value={editing!.color}
                      onChange={(e) => setEditing({ ...editing!, color: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer" />
                    <input type="text" value={editing!.name}
                      onChange={(e) => setEditing({ ...editing!, name: e.target.value })}
                      className="input-field text-sm flex-1" maxLength={50} />
                    <button onClick={updateCategory} disabled={saving} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded"><Check size={14} /></button>
                    <button onClick={() => setEditing(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"><X size={14} /></button>
                  </>
                ) : (
                  <>
                    <span className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm flex-1">
                      {cat.name}{cat.isDefault && <span className="ml-2 text-xs text-gray-400">(기본)</span>}
                    </span>
                    <button onClick={() => setEditing(cat)} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded"><Edit2 size={13} /></button>
                    {!cat.isDefault && (
                      <button onClick={() => deleteCategory(cat)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40">
          <div className="text-xs text-gray-500 mb-2 font-medium">새 카테고리 추가</div>
          <div className="flex gap-2">
            <input type="color" value={newCat.color}
              onChange={(e) => setNewCat({ ...newCat, color: e.target.value })}
              className="w-10 h-10 rounded-lg cursor-pointer" />
            <input type="text" value={newCat.name}
              onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
              className="input-field flex-1" placeholder="카테고리 이름" maxLength={50}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCategory(); } }} />
            <button onClick={createCategory} disabled={!newCat.name.trim() || saving} className="btn-primary"><Plus size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────── 작은 컴포넌트 ───────────────────

function ViewBtn({
  active, onClick, icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
        active ? 'bg-white dark:bg-slate-700 shadow text-primary-700 dark:text-primary-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200/50 dark:hover:bg-slate-700/50'
      }`}
    >
      {icon} {label}
    </button>
  );
}

// ─────────────────── 헬퍼 함수 ───────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function toLocalInput(d: Date, hour?: number, minute?: number): string {
  const h = hour !== undefined ? hour : d.getHours();
  const m = minute !== undefined ? minute : d.getMinutes();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
}

function toDayStart(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 반복 이벤트를 표시 범위 내에서 복제 expand
 * - 원본 이벤트는 1개 (DB에 저장된 것)
 * - 반복이 'daily/weekly/monthly/yearly'이면 시작일로부터 rangeEnd까지 복제
 * - repeatUntil이 있으면 그 전까지
 */
function expandRepeatedEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const ev of events) {
    if (ev.repeat === 'none' || !ev.repeat) { out.push(ev); continue; }

    const start = new Date(ev.startDate);
    const end = new Date(ev.endDate);
    const durationMs = end.getTime() - start.getTime();
    const until = ev.repeatUntil ? new Date(ev.repeatUntil) : rangeEnd;
    const hardEnd = until < rangeEnd ? until : rangeEnd;

    // 시작일 이후부터 hardEnd까지 각 반복 인스턴스 생성
    const cursor = new Date(start);
    let safetyCounter = 0;
    while (cursor <= hardEnd && safetyCounter < 500) {
      const instStart = new Date(cursor);
      const instEnd = new Date(cursor.getTime() + durationMs);
      // rangeStart 이후인 것만 렌더 대상
      if (instEnd >= rangeStart) {
        out.push({
          ...ev,
          id: `${ev.id}__r${safetyCounter}`, // 가상 id (편집 시 원본 id로 파싱 필요)
          startDate: instStart.toISOString(),
          endDate: instEnd.toISOString(),
        });
      }
      // 다음 반복
      switch (ev.repeat) {
        case 'daily': cursor.setDate(cursor.getDate() + 1); break;
        case 'weekly': cursor.setDate(cursor.getDate() + 7); break;
        case 'monthly': cursor.setMonth(cursor.getMonth() + 1); break;
        case 'yearly': cursor.setFullYear(cursor.getFullYear() + 1); break;
        default: safetyCounter = 500; break;
      }
      safetyCounter += 1;
    }
  }
  return out;
}
