import { useEffect, useState, useMemo } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Plus, X, Clock, MapPin } from 'lucide-react';
import api from '../services/api';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string;
  color?: string;
  scope: 'personal' | 'department' | 'company';
  repeat: string;
  creator: { id: string; name: string };
  attendees: { user: { id: string; name: string } }[];
}

const COLORS = ['#10B981', '#EF4444', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];
const scopeLabel: Record<string, string> = { personal: '개인', department: '부서', company: '전사' };

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [, setSelectedDate] = useState<Date | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => {
    fetchEvents();
  }, [year, month]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const start = new Date(year, month, 1).toISOString();
      const end = new Date(year, month + 1, 0).toISOString();
      const res = await api.get(`/calendar/events?start=${start}&end=${end}`);
      setEvents(res.data.data);
    } catch (err) {
      console.error('Calendar fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const prevLastDate = new Date(year, month, 0).getDate();
    const days: { date: number; month: 'prev' | 'current' | 'next'; fullDate: Date }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ date: prevLastDate - i, month: 'prev', fullDate: new Date(year, month - 1, prevLastDate - i) });
    }
    for (let i = 1; i <= lastDate; i++) {
      days.push({ date: i, month: 'current', fullDate: new Date(year, month, i) });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: i, month: 'next', fullDate: new Date(year, month + 1, i) });
    }
    return days;
  }, [year, month]);

  const getEventsForDate = (date: Date) => {
    return events.filter((e) => {
      const start = new Date(e.startDate);
      const end = new Date(e.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      const d = new Date(date);
      d.setHours(12, 0, 0, 0);
      return d >= start && d <= end;
    });
  };

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const today = new Date();
  const isToday = (d: Date) => d.toDateString() === today.toDateString();

  const formatTime = (dt: string) => new Date(dt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

  const handleCreateEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api.post('/calendar/events', {
        title: form.get('title'),
        description: form.get('description') || undefined,
        startDate: new Date(form.get('startDate') as string).toISOString(),
        endDate: new Date(form.get('endDate') as string).toISOString(),
        allDay: form.get('allDay') === 'on',
        location: form.get('location') || undefined,
        color: form.get('color') || '#10B981',
        scope: form.get('scope') || 'personal',
      });
      setShowCreateModal(false);
      fetchEvents();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '일정 생성 중 오류가 발생했습니다');
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('일정을 삭제하시겠습니까?')) return;
    try {
      await api.delete(`/calendar/events/${id}`);
      setSelectedEvent(null);
      fetchEvents();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '삭제 중 오류가 발생했습니다');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar size={24} /> 캘린더
        </h1>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> 일정 추가
        </button>
      </div>

      {/* Calendar Header */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={prevMonth} className="p-2 hover:bg-primary-50/50 rounded-2xl"><ChevronLeft size={20} /></button>
            <h2 className="text-xl font-bold">
              {year}년 {month + 1}월
            </h2>
            <button onClick={nextMonth} className="p-2 hover:bg-primary-50/50 rounded-2xl"><ChevronRight size={20} /></button>
          </div>
          <button onClick={goToday} className="btn-secondary text-sm">오늘</button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 mb-2">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <div key={d} className={`text-center text-sm font-medium py-2 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 border-t border-l">
          {calendarDays.map((day, idx) => {
            const dayEvents = getEventsForDate(day.fullDate);
            return (
              <div
                key={idx}
                onClick={() => setSelectedDate(day.fullDate)}
                className={`min-h-[100px] border-r border-b p-1 cursor-pointer hover:bg-primary-50/50 ${
                  day.month !== 'current' ? 'bg-gray-50' : ''
                } ${isToday(day.fullDate) ? 'bg-primary-50' : ''}`}
              >
                <p className={`text-sm font-medium mb-1 ${
                  day.month !== 'current' ? 'text-gray-300' :
                  isToday(day.fullDate) ? 'text-primary-700 font-bold' :
                  idx % 7 === 0 ? 'text-red-500' :
                  idx % 7 === 6 ? 'text-blue-500' : 'text-gray-700'
                }`}>
                  {day.date}
                </p>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                      className="text-xs px-1 py-0.5 rounded truncate text-white cursor-pointer"
                      style={{ backgroundColor: ev.color || '#10B981' }}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <p className="text-xs text-gray-400">+{dayEvents.length - 3}개</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedEvent.color || '#10B981' }} />
                <h3 className="text-lg font-bold">{selectedEvent.title}</h3>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock size={16} />
                {selectedEvent.allDay ? '종일' : `${formatTime(selectedEvent.startDate)} ~ ${formatTime(selectedEvent.endDate)}`}
              </div>
              {selectedEvent.location && (
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin size={16} /> {selectedEvent.location}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  selectedEvent.scope === 'company' ? 'bg-purple-100 text-purple-700' :
                  selectedEvent.scope === 'department' ? 'bg-teal-100 text-teal-700' :
                  'bg-gray-100 text-gray-700'
                }`}>{scopeLabel[selectedEvent.scope]}</span>
                <span className="text-gray-400">| 작성: {selectedEvent.creator.name}</span>
              </div>
              {selectedEvent.description && (
                <p className="text-gray-600 mt-2 whitespace-pre-wrap">{selectedEvent.description}</p>
              )}
              {selectedEvent.attendees.length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1">참석자</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedEvent.attendees.map((a) => (
                      <span key={a.user.id} className="px-2 py-1 bg-gray-100 rounded text-xs">{a.user.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => handleDeleteEvent(selectedEvent.id)} className="btn-secondary text-red-600 hover:bg-red-50">삭제</button>
              <button onClick={() => setSelectedEvent(null)} className="btn-primary">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">일정 추가</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateEvent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제목</label>
                <input type="text" name="title" className="input-field" required maxLength={200} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">시작</label>
                  <input type="datetime-local" name="startDate" className="input-field" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">종료</label>
                  <input type="datetime-local" name="endDate" className="input-field" required />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" name="allDay" id="allDay" className="rounded" />
                <label htmlFor="allDay" className="text-sm text-gray-700">종일</label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">장소</label>
                <input type="text" name="location" className="input-field" maxLength={200} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">범위</label>
                <select name="scope" className="input-field">
                  <option value="personal">개인</option>
                  <option value="department">부서</option>
                  <option value="company">전사</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">색상</label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <label key={c} className="cursor-pointer">
                      <input type="radio" name="color" value={c} className="sr-only" defaultChecked={c === '#10B981'} />
                      <div className="w-8 h-8 rounded-full border-2 border-transparent hover:border-gray-300" style={{ backgroundColor: c }} />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea name="description" rows={3} className="input-field" maxLength={2000} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">취소</button>
                <button type="submit" className="btn-primary">저장</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
