/**
 * 캘린더 (Phase 2 Week 6) — 월간 그리드 + 일자별 이벤트 카드 + 간단 일정 추가.
 *
 * 화면 구성:
 *   ┌─────────────────────────┐
 *   │  ◀  2026년 4월  ▶       │  헤더 (월 이동)
 *   ├─────────────────────────┤
 *   │  일 월 화 수 목 금 토   │  요일 행
 *   │  6 x 7 그리드           │  날짜 셀 (오늘/선택/이벤트 dot)
 *   ├─────────────────────────┤
 *   │  4월 23일 (목)          │
 *   │  ─ 09:00 회의           │  선택된 날의 일정 카드
 *   │  ─ 종일 휴가            │
 *   └─────────────────────────┘
 *   FAB: ＋ 새 일정
 *
 * 데이터:
 *   - 월 변경 시 1회 fetch (해당 월 + 좌우 7일 패딩)
 *   - 일정 추가 후 즉시 refetch
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity, Modal, TextInput, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string | null;
  color?: string | null;
  category?: { id: string; name: string; color: string } | null;
  creator?: { id: string; name: string };
}

interface Category {
  id: string;
  name: string;
  color: string;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

export default function CalendarScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);

  // 화면 상태
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedISO, setSelectedISO] = useState(() => toISODate(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // 월별 fetch
  const fetchEvents = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const start = new Date(month.getFullYear(), month.getMonth(), 1);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      end.setDate(end.getDate() + 7);
      end.setHours(23, 59, 59, 999);
      const res = await api.get(
        `/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
      );
      setEvents(res.data?.data ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(cursor); }, [cursor, fetchEvents]);

  useEffect(() => {
    api.get('/calendar/categories')
      .then((res) => setCategories(res.data?.data ?? []))
      .catch(() => setCategories([]));
  }, []);

  // 월 그리드 생성 — 6주 x 7일 = 42일
  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const eventsByDay = useMemo(() => groupByDay(events), [events]);

  const monthLabel = `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
  const goPrev = () => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goNext = () => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => {
    const today = new Date();
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedISO(toISODate(today));
  };

  const todayISO = toISODate(new Date());
  const selectedDayEvents = (eventsByDay[selectedISO] ?? []).slice().sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  return (
    <>
      <Stack.Screen options={{ title: '캘린더' }} />
      <View style={styles.container}>
        {/* 헤더 — 월 이동 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={goPrev} style={styles.navBtn}>
            <Text style={styles.navBtnText}>◀</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goToday} style={styles.monthLabelWrap}>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Text style={styles.todayHint}>오늘로</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goNext} style={styles.navBtn}>
            <Text style={styles.navBtnText}>▶</Text>
          </TouchableOpacity>
        </View>

        {/* 요일 행 */}
        <View style={styles.weekdayRow}>
          {WEEKDAY.map((w, i) => (
            <Text key={w} style={[
              styles.weekdayCell,
              i === 0 ? styles.weekdaySun : i === 6 ? styles.weekdaySat : null,
            ]}>{w}</Text>
          ))}
        </View>

        {/* 월 그리드 */}
        <View style={styles.grid}>
          {grid.map((row, rIdx) => (
            <View key={rIdx} style={styles.row}>
              {row.map((cell) => {
                const iso = toISODate(cell.date);
                const isToday = iso === todayISO;
                const isSelected = iso === selectedISO;
                const events = eventsByDay[iso] ?? [];
                const eventsLimit = events.slice(0, 3);
                return (
                  <TouchableOpacity
                    key={iso}
                    onPress={() => setSelectedISO(iso)}
                    activeOpacity={0.6}
                    style={[
                      styles.cell,
                      !cell.inCurrentMonth && styles.cellOutMonth,
                      isSelected && styles.cellSelected,
                    ]}
                  >
                    <Text style={[
                      styles.cellDay,
                      !cell.inCurrentMonth && styles.cellDayOut,
                      isToday && styles.cellDayToday,
                      isSelected && styles.cellDaySelected,
                    ]}>
                      {cell.date.getDate()}
                    </Text>
                    <View style={styles.dotRow}>
                      {eventsLimit.map((ev) => (
                        <View
                          key={ev.id}
                          style={[
                            styles.dot,
                            { backgroundColor: ev.color || ev.category?.color || COLORS.primary[500] },
                          ]}
                        />
                      ))}
                      {events.length > 3 && <Text style={styles.dotMore}>+</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        {/* 선택 일자 이벤트 리스트 */}
        <ScrollView
          style={styles.dayPanel}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchEvents(cursor); setRefreshing(false); }} />}
        >
          <Text style={styles.dayHeader}>
            {labelDay(selectedISO)}
            {selectedDayEvents.length > 0 && (
              <Text style={styles.dayCount}> · {selectedDayEvents.length}건</Text>
            )}
          </Text>
          {loading && events.length === 0 ? (
            <ActivityIndicator color={COLORS.primary[500]} style={{ marginTop: 24 }} />
          ) : selectedDayEvents.length === 0 ? (
            <Text style={styles.dayEmpty}>일정이 없습니다</Text>
          ) : (
            selectedDayEvents.map((ev) => {
              const color = ev.color || ev.category?.color || COLORS.primary[500];
              return (
                <View key={ev.id} style={[styles.eventCard, { borderLeftColor: color }]}>
                  <View style={styles.eventHeader}>
                    <Text style={styles.eventTitle}>{ev.title}</Text>
                    <Text style={styles.eventTime}>{fmtTime(ev.startDate, ev.allDay)}</Text>
                  </View>
                  {ev.description && <Text style={styles.eventDesc} numberOfLines={2}>{ev.description}</Text>}
                  {ev.location && <Text style={styles.eventMeta}>📍 {ev.location}</Text>}
                  {ev.category && <Text style={styles.eventMeta}>#{ev.category.name}</Text>}
                  {ev.creator?.name && <Text style={styles.eventMeta}>👤 {ev.creator.name}</Text>}
                </View>
              );
            })
          )}
        </ScrollView>

        {/* FAB */}
        <TouchableOpacity onPress={() => setShowAdd(true)} style={styles.fab}>
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      </View>

      {/* 일정 추가 모달 */}
      <AddEventModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => { setShowAdd(false); fetchEvents(cursor); }}
        defaultDateISO={selectedISO}
        categories={categories}
        styles={styles}
        c={c}
      />
    </>
  );
}

/* ───────── 일정 추가 모달 ───────── */
function AddEventModal({
  visible, onClose, onCreated, defaultDateISO, categories, styles, c,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultDateISO: string;
  categories: Category[];
  styles: any;
  c: SemanticColors;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState(defaultDateISO);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (visible) setDate(defaultDateISO); }, [visible, defaultDateISO]);

  const submit = async () => {
    if (!title.trim()) {
      Alert.alert('알림', '제목을 입력하세요');
      return;
    }
    let startDate: Date, endDate: Date;
    if (allDay) {
      startDate = new Date(`${date}T00:00:00`);
      endDate = new Date(`${date}T23:59:59`);
    } else {
      startDate = new Date(`${date}T${startTime}:00`);
      endDate = new Date(`${date}T${endTime}:00`);
      if (endDate <= startDate) {
        Alert.alert('알림', '종료 시각이 시작 시각보다 이후여야 합니다');
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.post('/calendar/events', {
        title: title.trim(),
        description: description.trim() || undefined,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        allDay,
        location: location.trim() || undefined,
        categoryId: categoryId || undefined,
        scope: 'personal',
      });
      // reset
      setTitle(''); setDescription(''); setLocation(''); setAllDay(false);
      setStartTime('09:00'); setEndTime('10:00'); setCategoryId(null);
      onCreated();
    } catch (err: any) {
      Alert.alert('실패', err?.response?.data?.error?.message ?? '일정 생성 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalContainer}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>새 일정</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ fontSize: 22, color: c.textSubtle }}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 500 }} contentContainerStyle={{ padding: 20 }}>
            <Text style={styles.inputLabel}>제목 *</Text>
            <TextInput
              value={title} onChangeText={setTitle}
              placeholder="일정 제목"
              placeholderTextColor={c.placeholder}
              style={styles.input}
            />

            <Text style={styles.inputLabel}>날짜</Text>
            <TextInput
              value={date} onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.placeholder}
              style={styles.input}
            />

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 }}>
              <TouchableOpacity onPress={() => setAllDay(!allDay)} style={[styles.chip, allDay && styles.chipActive]}>
                <Text style={[styles.chipText, allDay && styles.chipTextActive]}>{allDay ? '✓ ' : ''}종일</Text>
              </TouchableOpacity>
            </View>

            {!allDay && (
              <>
                <Text style={styles.inputLabel}>시작 시각 (HH:MM)</Text>
                <TextInput
                  value={startTime} onChangeText={setStartTime}
                  placeholder="09:00"
                  placeholderTextColor={c.placeholder}
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>종료 시각 (HH:MM)</Text>
                <TextInput
                  value={endTime} onChangeText={setEndTime}
                  placeholder="10:00"
                  placeholderTextColor={c.placeholder}
                  style={styles.input}
                />
              </>
            )}

            <Text style={styles.inputLabel}>장소 (선택)</Text>
            <TextInput
              value={location} onChangeText={setLocation}
              placeholder="회의실, 카페 등"
              placeholderTextColor={c.placeholder}
              style={styles.input}
            />

            {categories.length > 0 && (
              <>
                <Text style={styles.inputLabel}>카테고리 (선택)</Text>
                <View style={styles.catRow}>
                  <TouchableOpacity
                    onPress={() => setCategoryId(null)}
                    style={[styles.chip, categoryId === null && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, categoryId === null && styles.chipTextActive]}>없음</Text>
                  </TouchableOpacity>
                  {categories.map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => setCategoryId(cat.id)}
                      style={[styles.chip, categoryId === cat.id && { backgroundColor: cat.color }]}
                    >
                      <Text style={[
                        styles.chipText,
                        categoryId === cat.id && styles.chipTextActive,
                      ]}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.inputLabel}>설명 (선택)</Text>
            <TextInput
              value={description} onChangeText={setDescription}
              placeholder="추가 설명"
              placeholderTextColor={c.placeholder}
              multiline
              style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
            />

            <TouchableOpacity
              onPress={submit}
              disabled={submitting || !title.trim()}
              style={[styles.submitBtn, (submitting || !title.trim()) && styles.submitBtnDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.submitBtnText}>일정 만들기</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ───────── 헬퍼 ───────── */
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n: number) { return String(n).padStart(2, '0'); }

function buildMonthGrid(cursor: Date): { date: Date; inCurrentMonth: boolean }[][] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay(); // 0=일
  const start = new Date(year, month, 1 - startOffset);

  const rows: { date: Date; inCurrentMonth: boolean }[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: { date: Date; inCurrentMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + r * 7 + d);
      row.push({ date, inCurrentMonth: date.getMonth() === month });
    }
    rows.push(row);
  }
  return rows;
}

function groupByDay(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const map: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    const start = new Date(ev.startDate);
    const end = new Date(ev.endDate);
    // 멀티-데이 이벤트는 각 날짜에 등록
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const stop = new Date(end);
    stop.setHours(0, 0, 0, 0);
    while (cur <= stop) {
      const k = toISODate(cur);
      if (!map[k]) map[k] = [];
      map[k].push(ev);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return map;
}

function labelDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  const labels: Record<number, string> = { 0: '오늘', 1: '내일', [-1]: '어제' };
  const prefix = labels[diff] ? `${labels[diff]} · ` : '';
  return `${prefix}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]})`;
}

function fmtTime(iso: string, allDay: boolean): string {
  if (allDay) return '종일';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

/* ───────── 스타일 ───────── */
const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  /* 헤더 */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  navBtnText: { fontSize: 14, color: c.text, fontWeight: '700' },
  monthLabelWrap: { flex: 1, alignItems: 'center' },
  monthLabel: { fontSize: 17, fontWeight: '700', color: c.text },
  todayHint: { fontSize: 10, color: c.textSubtle, marginTop: 2 },

  /* 요일 */
  weekdayRow: { flexDirection: 'row', backgroundColor: c.surface, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.divider },
  weekdayCell: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: c.textMuted },
  weekdaySun: { color: '#dc2626' },
  weekdaySat: { color: '#2563eb' },

  /* 그리드 */
  grid: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  row: { flexDirection: 'row' },
  cell: {
    flex: 1, height: 56,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: c.divider,
    paddingTop: 4, paddingHorizontal: 4, alignItems: 'center',
  },
  cellOutMonth: { backgroundColor: isDark ? '#0d130f' : '#fafafa' },
  cellSelected: { backgroundColor: isDark ? '#13261c' : '#f0fdf4' },
  cellDay: { fontSize: 13, color: c.text, fontWeight: '500' },
  cellDayOut: { color: c.textSubtle },
  cellDayToday: { color: COLORS.primary[600], fontWeight: '700' },
  cellDaySelected: { color: COLORS.primary[700] },
  dotRow: { flexDirection: 'row', gap: 2, marginTop: 4, alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dotMore: { fontSize: 8, color: c.textSubtle, marginLeft: 1 },

  /* 일자 패널 */
  dayPanel: { flex: 1 },
  dayHeader: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 12 },
  dayCount: { color: c.textMuted, fontWeight: '500', fontSize: 12 },
  dayEmpty: { color: c.textSubtle, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  eventCard: {
    backgroundColor: c.surface, padding: 12, borderRadius: 12, marginBottom: 8, borderLeftWidth: 4,
    borderWidth: isDark ? 1 : 0, borderColor: c.border,
  },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eventTitle: { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
  eventTime: { fontSize: 12, color: c.textMuted, marginLeft: 8 },
  eventDesc: { fontSize: 12, color: c.textMuted, marginTop: 4, lineHeight: 18 },
  eventMeta: { fontSize: 11, color: c.textSubtle, marginTop: 3 },

  /* FAB */
  fab: {
    position: 'absolute', right: 20, bottom: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary[500],
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary[500], shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabIcon: { fontSize: 28, color: '#ffffff', fontWeight: '300', marginTop: -2 },

  /* 모달 */
  modalOverlay: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 24 : 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: c.divider },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  inputLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.surfaceAlt },

  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  chipActive: { backgroundColor: COLORS.primary[500], borderColor: COLORS.primary[500] },
  chipText: { fontSize: 12, fontWeight: '600', color: c.text },
  chipTextActive: { color: '#ffffff' },

  submitBtn: { marginTop: 20, backgroundColor: COLORS.primary[500], borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { backgroundColor: c.border },
  submitBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
