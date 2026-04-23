/**
 * 캘린더 페이지 (v0.20.0 전면 개편)
 *
 * 기능:
 *   - 월별 그리드 (7 x 6)
 *   - **단일 클릭**: 해당 날짜에 새 일정 모달 (allDay)
 *   - **드래그 선택**: 시작→끝 날짜 범위로 장기 일정 모달
 *   - 이벤트 클릭 → 상세 + 편집 + 삭제
 *   - 카테고리 (색 + 이름) CRUD + 사이드바 필터
 *   - 카테고리 선택 시 색상 자동 적용 (개별 override 가능)
 *
 * 백엔드:
 *   GET/POST/PATCH/DELETE /calendar/events
 *   GET/POST/PATCH/DELETE /calendar/categories
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Clock, MapPin,
  Trash2, Edit2, Tag, Check, Save,
} from 'lucide-react';
import api from '../services/api';

interface CalendarCategory {
  id: string;
  name: string;
  color: string;
  ownerId: string | null;
  isDefault: boolean;
  sortOrder: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string;
  color?: string;
  categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
  scope: 'personal' | 'department' | 'company';
  repeat: string;
  creator: { id: string; name: string };
  attendees: { user: { id: string; name: string } }[];
}

type FormMode = 'create' | 'edit';

interface EventFormState {
  id?: string;
  title: string;
  description: string;
  startDate: string; // YYYY-MM-DDTHH:mm
  endDate: string;
  allDay: boolean;
  location: string;
  categoryId: string;
  color: string;
  scope: 'personal' | 'department' | 'company';
}

const COLOR_PALETTE = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#6b7280',
];

const SCOPE_LABEL: Record<string, string> = { personal: '개인', department: '부서', company: '전사' };

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  const [hiddenCatIds, setHiddenCatIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('po-cal-hidden-cats') || '[]')); } catch { return new Set(); }
  });
  const [currentDate, setCurrentDate] = useState(new Date());

  // 드래그 다중선택
  const [dragSelection, setDragSelection] = useState<{ start: Date; current: Date } | null>(null);
  const isDraggingRef = useRef(false);

  // 모달
  const [eventForm, setEventForm] = useState<{ mode: FormMode; open: boolean; form: EventFormState } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // ── fetch ──
  const fetchEvents = useCallback(async () => {
    try {
      const start = new Date(year, month - 1, 20).toISOString(); // 이전 달 말 포함
      const end = new Date(year, month + 2, 10).toISOString();   // 다음 달 초 포함
      const res = await api.get(`/calendar/events?start=${start}&end=${end}`);
      setEvents(res.data.data || []);
    } catch { /* ignore */ }
  }, [year, month]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/calendar/categories');
      setCategories(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // 카테고리 필터 저장
  useEffect(() => {
    localStorage.setItem('po-cal-hidden-cats', JSON.stringify(Array.from(hiddenCatIds)));
  }, [hiddenCatIds]);

  // ── 그리드 ──
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();
    const days: { date: number; month: 'prev' | 'current' | 'next'; fullDate: Date }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) days.push({ date: prevLastDate - i, month: 'prev', fullDate: new Date(year, month - 1, prevLastDate - i) });
    for (let i = 1; i <= lastDate; i++) days.push({ date: i, month: 'current', fullDate: new Date(year, month, i) });
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: i, month: 'next', fullDate: new Date(year, month + 1, i) });
    return days;
  }, [year, month]);

  // 카테고리 필터 적용된 이벤트 맵
  const visibleEvents = useMemo(() => {
    return events.filter((e) => {
      const catId = e.category?.id ?? e.categoryId ?? '__uncategorized__';
      if (catId === '__uncategorized__') return !hiddenCatIds.has('__uncategorized__');
      return !hiddenCatIds.has(catId);
    });
  }, [events, hiddenCatIds]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visibleEvents) {
      const start = new Date(e.startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(e.endDate); end.setHours(23, 59, 59, 999);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = dateKey(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [visibleEvents]);

  // ── 드래그 선택 ──
  const handleMouseDown = (date: Date, e: React.MouseEvent) => {
    // 이벤트 칩 클릭은 드래그 시작 아님
    if ((e.target as HTMLElement).closest('[data-event-chip]')) return;
    isDraggingRef.current = true;
    setDragSelection({ start: date, current: date });
  };
  const handleMouseEnter = (date: Date) => {
    if (isDraggingRef.current && dragSelection) {
      setDragSelection({ ...dragSelection, current: date });
    }
  };
  const handleMouseUp = () => {
    if (isDraggingRef.current && dragSelection) {
      const [s, e] = [dragSelection.start, dragSelection.current].sort((a, b) => a.getTime() - b.getTime());
      const defaultCat = categories.find((c) => c.isDefault) || categories[0];
      openCreateForm({
        startDate: toLocalInput(s, 9, 0),
        endDate: toLocalInput(e, 18, 0),
        allDay: s.toDateString() !== e.toDateString(), // 다중일=allDay 기본
        categoryId: defaultCat?.id || '',
        color: defaultCat?.color || '#3b82f6',
      });
    }
    isDraggingRef.current = false;
    setDragSelection(null);
  };

  const isInDragRange = (date: Date) => {
    if (!dragSelection) return false;
    const [s, e] = [dragSelection.start.getTime(), dragSelection.current.getTime()].sort((a, b) => a - b);
    const t = date.getTime();
    return t >= s && t <= e;
  };

  // ── Form helpers ──
  const openCreateForm = (partial: Partial<EventFormState> = {}) => {
    const defaultCat = categories.find((c) => c.isDefault) || categories[0];
    const now = new Date();
    setEventForm({
      mode: 'create',
      open: true,
      form: {
        title: '',
        description: '',
        startDate: partial.startDate ?? toLocalInput(now, 9, 0),
        endDate: partial.endDate ?? toLocalInput(now, 10, 0),
        allDay: partial.allDay ?? false,
        location: '',
        categoryId: partial.categoryId ?? defaultCat?.id ?? '',
        color: partial.color ?? defaultCat?.color ?? '#3b82f6',
        scope: 'personal',
      },
    });
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
        scope: ev.scope,
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
      scope: f.scope,
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
      fetchEvents();
    } catch { alert('삭제 실패'); }
  };

  // ── 네비게이션 ──
  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const today = new Date();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  const toggleCategoryFilter = (id: string) => {
    setHiddenCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 md:p-6 flex gap-4" onMouseUp={handleMouseUp}>
      {/* ─── 좌측 사이드바 ─── */}
      <aside className="w-56 shrink-0 space-y-4">
        <button
          onClick={() => openCreateForm()}
          className="btn-primary w-full flex items-center justify-center gap-1.5"
        >
          <Plus size={16} /> 일정 추가
        </button>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <Tag size={14} /> 카테고리
            </h3>
            <button
              onClick={() => setShowCategoryManager(true)}
              className="text-xs text-primary-600 hover:underline"
              title="카테고리 관리"
            >
              관리
            </button>
          </div>
          <div className="space-y-1">
            {categories.map((cat) => {
              const hidden = hiddenCatIds.has(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategoryFilter(cat.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors ${hidden ? 'opacity-40' : ''}`}
                  title={hidden ? '보이기' : '숨기기'}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-offset-1 dark:ring-offset-slate-800"
                    style={{ backgroundColor: cat.color, '--tw-ring-color': cat.color } as React.CSSProperties}
                  />
                  <span className={`text-sm truncate flex-1 text-left ${cat.isDefault ? 'font-medium' : ''}`}>
                    {cat.name}
                  </span>
                  {!hidden && <Check size={12} className="text-primary-500 shrink-0" />}
                </button>
              );
            })}
            {/* 카테고리 없는 이벤트 필터 */}
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
          <p>• 날짜 클릭 → 일정 추가</p>
          <p>• 드래그 → 장기 일정</p>
          <p>• 일정 클릭 → 편집/삭제</p>
        </div>
      </aside>

      {/* ─── 우측 캘린더 ─── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon size={24} className="text-primary-600" />
              {year}년 {month + 1}월
            </h1>
            <button onClick={nextMonth} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg">
              <ChevronRight size={20} />
            </button>
          </div>
          <button onClick={goToday} className="btn-secondary text-sm">오늘</button>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden select-none">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <div
                key={d}
                className={`text-center text-xs font-semibold py-2 ${
                  i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {/* 셀 */}
          <div className="grid grid-cols-7">
            {calendarDays.map((day, idx) => {
              const dayKey = dateKey(day.fullDate);
              const dayEvents = eventsByDate.get(dayKey) || [];
              const isOtherMonth = day.month !== 'current';
              const inDrag = isInDragRange(day.fullDate);
              const dow = idx % 7;
              return (
                <div
                  key={idx}
                  onMouseDown={(e) => handleMouseDown(day.fullDate, e)}
                  onMouseEnter={() => handleMouseEnter(day.fullDate)}
                  onClick={() => {
                    if (!isDraggingRef.current && dragSelection === null) {
                      // 단일 클릭 — 드래그 없이 종료한 경우
                      const defaultCat = categories.find((c) => c.isDefault) || categories[0];
                      openCreateForm({
                        startDate: toLocalInput(day.fullDate, 9, 0),
                        endDate: toLocalInput(day.fullDate, 10, 0),
                        allDay: false,
                        categoryId: defaultCat?.id || '',
                        color: defaultCat?.color || '#3b82f6',
                      });
                    }
                  }}
                  className={`
                    min-h-[110px] border-r border-b border-gray-200 dark:border-slate-700 last:border-r-0 p-1.5 cursor-pointer transition-colors
                    ${isOtherMonth ? 'bg-gray-50/60 dark:bg-slate-900/40' : ''}
                    ${isToday(day.fullDate) ? 'bg-primary-50/60 dark:bg-primary-900/20' : ''}
                    ${inDrag ? 'bg-primary-200/60 dark:bg-primary-700/30 ring-2 ring-inset ring-primary-500' : ''}
                    ${!isOtherMonth && !isToday(day.fullDate) && !inDrag ? 'hover:bg-gray-50 dark:hover:bg-slate-700/40' : ''}
                    ${(idx + 1) % 7 === 0 ? '' : ''}
                  `}
                >
                  <div
                    className={`
                      text-xs font-semibold mb-1 px-1
                      ${isOtherMonth ? 'text-gray-400 dark:text-gray-600' : ''}
                      ${isToday(day.fullDate) ? 'text-primary-700 dark:text-primary-300' : ''}
                      ${!isOtherMonth && !isToday(day.fullDate) && dow === 0 ? 'text-red-500' : ''}
                      ${!isOtherMonth && !isToday(day.fullDate) && dow === 6 ? 'text-blue-500' : ''}
                    `}
                  >
                    {day.date}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev) => {
                      const color = ev.color || ev.category?.color || '#6b7280';
                      return (
                        <div
                          key={ev.id}
                          data-event-chip
                          onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                          className="text-[11px] px-1.5 py-0.5 rounded truncate text-white cursor-pointer hover:opacity-85 transition-opacity font-medium"
                          style={{ backgroundColor: color }}
                          title={`${ev.title}${ev.category ? ` · ${ev.category.name}` : ''}`}
                        >
                          {ev.title}
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
      </div>

      {/* ─── 이벤트 상세 모달 ─── */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => openEditForm(selectedEvent)}
          onDelete={() => handleDeleteEvent(selectedEvent.id)}
        />
      )}

      {/* ─── 이벤트 생성/편집 모달 ─── */}
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

      {/* ─── 카테고리 관리 모달 ─── */}
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

/* ═════════ 이벤트 상세 모달 ═════════ */

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
            <button onClick={onEdit} className="p-1.5 text-primary-600 hover:bg-primary-50 rounded" title="편집">
              <Edit2 size={14} />
            </button>
            <button onClick={onDelete} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="삭제">
              <Trash2 size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
              <X size={14} />
            </button>
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
                <>
                  하루 종일 · {fmtDate(event.startDate)}
                  {event.startDate.slice(0, 10) !== event.endDate.slice(0, 10) && ` ~ ${fmtDate(event.endDate)}`}
                </>
              ) : (
                <>
                  {fmtDateTime(event.startDate)}<br />
                  ~ {fmtDateTime(event.endDate)}
                </>
              )}
            </div>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-gray-400 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300">{event.location}</span>
            </div>
          )}
          {event.description && (
            <div className="pt-2 text-gray-600 dark:text-gray-400 whitespace-pre-wrap border-t border-gray-100 dark:border-slate-700">
              {event.description}
            </div>
          )}
          <div className="pt-3 text-xs text-gray-400 flex items-center justify-between border-t border-gray-100 dark:border-slate-700">
            <span>{SCOPE_LABEL[event.scope]} · {event.creator?.name ?? ''}</span>
            {event.attendees && event.attendees.length > 0 && (
              <span>참석자 {event.attendees.length}명</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═════════ 이벤트 생성/편집 모달 ═════════ */

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
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold">{mode === 'create' ? '일정 추가' : '일정 편집'}</h3>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">제목 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
              required
              maxLength={200}
              autoFocus
              className="input-field w-full"
              placeholder="일정 제목"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">카테고리</label>
            <div className="flex gap-2">
              <select
                value={form.categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="input-field flex-1"
              >
                <option value="">(미분류)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="relative">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => onChange({ ...form, color: e.target.value })}
                  className="w-12 h-10 rounded-lg cursor-pointer border border-gray-300"
                  title="개별 색상"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="allDay"
              checked={form.allDay}
              onChange={(e) => onChange({ ...form, allDay: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="allDay" className="text-sm text-gray-700 dark:text-gray-300">하루 종일</label>
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
                required
                className="input-field w-full"
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
                required
                className="input-field w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">장소</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => onChange({ ...form, location: e.target.value })}
              maxLength={200}
              className="input-field w-full"
              placeholder="회의실 A, 사무실, 온라인 등"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">설명</label>
            <textarea
              value={form.description}
              onChange={(e) => onChange({ ...form, description: e.target.value })}
              maxLength={2000}
              rows={3}
              className="input-field w-full resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">공개 범위</label>
            <select
              value={form.scope}
              onChange={(e) => onChange({ ...form, scope: e.target.value as EventFormState['scope'] })}
              className="input-field w-full"
            >
              <option value="personal">개인</option>
              <option value="department">부서</option>
              <option value="company">전사</option>
            </select>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-700 flex gap-2 justify-end">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="btn-secondary text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 mr-auto"
            >
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

/* ═════════ 카테고리 관리 모달 ═════════ */

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
      await api.patch(`/calendar/categories/${editing.id}`, {
        name: editing.name,
        color: editing.color,
      });
      setEditing(null);
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '수정 실패');
    } finally { setSaving(false); }
  };

  const deleteCategory = async (cat: CalendarCategory) => {
    if (cat.isDefault) { alert('기본 카테고리는 삭제할 수 없습니다'); return; }
    if (!confirm(`"${cat.name}" 카테고리를 삭제할까요?\n(이 카테고리를 사용하던 일정은 "(미분류)"로 변경됩니다)`)) return;
    try {
      await api.delete(`/calendar/categories/${cat.id}`);
      onChanged();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      alert(e.response?.data?.error?.message || '삭제 실패');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-1.5">
            <Tag size={16} /> 카테고리 관리
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          {categories.map((cat) => {
            const isEditingThis = editing?.id === cat.id;
            return (
              <div
                key={cat.id}
                className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-slate-700/40 rounded-lg"
              >
                {isEditingThis ? (
                  <>
                    <input
                      type="color"
                      value={editing!.color}
                      onChange={(e) => setEditing({ ...editing!, color: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editing!.name}
                      onChange={(e) => setEditing({ ...editing!, name: e.target.value })}
                      className="input-field text-sm flex-1"
                      maxLength={50}
                    />
                    <button
                      onClick={updateCategory}
                      disabled={saving}
                      className="p-1.5 text-primary-600 hover:bg-primary-50 rounded"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="w-5 h-5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-sm flex-1">
                      {cat.name}
                      {cat.isDefault && <span className="ml-2 text-xs text-gray-400">(기본)</span>}
                    </span>
                    <button
                      onClick={() => setEditing(cat)}
                      className="p-1.5 text-primary-600 hover:bg-primary-50 rounded"
                      title="편집"
                    >
                      <Edit2 size={13} />
                    </button>
                    {!cat.isDefault && (
                      <button
                        onClick={() => deleteCategory(cat)}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                        title="삭제"
                      >
                        <Trash2 size={13} />
                      </button>
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
            <input
              type="color"
              value={newCat.color}
              onChange={(e) => setNewCat({ ...newCat, color: e.target.value })}
              className="w-10 h-10 rounded-lg cursor-pointer"
            />
            <input
              type="text"
              value={newCat.name}
              onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
              className="input-field flex-1"
              placeholder="카테고리 이름"
              maxLength={50}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCategory(); } }}
            />
            <button
              onClick={createCategory}
              disabled={!newCat.name.trim() || saving}
              className="btn-primary"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═════════ Helpers ═════════ */

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toLocalInput(d: Date, hour?: number, minute?: number): string {
  const h = hour !== undefined ? hour : d.getHours();
  const m = minute !== undefined ? minute : d.getMinutes();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
