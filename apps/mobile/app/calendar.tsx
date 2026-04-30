import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';

interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  location?: string | null;
  color?: string | null;
  category?: { id: string; name: string; color: string } | null;
  creator: { id: string; name: string };
}

export default function CalendarScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      // 앞뒤 2주 범위
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setDate(end.getDate() + 14);
      end.setHours(23, 59, 59, 999);
      const res = await api.get(`/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`);
      setEvents(res.data?.data ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, []);

  // 날짜별 그룹화
  const byDay = events.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
    const k = ev.startDate.slice(0, 10);
    if (!acc[k]) acc[k] = [];
    acc[k].push(ev);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort();

  const fmtDay = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((d.getTime() - today.getTime()) / (86400 * 1000));
    const labels: Record<number, string> = { 0: '오늘', 1: '내일', [-1]: '어제' };
    const prefix = labels[diff] ? `${labels[diff]} · ` : '';
    return `${prefix}${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`;
  };

  const fmtTime = (iso: string, allDay: boolean) => {
    if (allDay) return '종일';
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <Stack.Screen options={{ title: '캘린더' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
      >
        {loading && events.length === 0 ? (
          <View style={styles.centerBox}><ActivityIndicator color={COLORS.primary[500]} /></View>
        ) : days.length === 0 ? (
          <View style={styles.centerBox}><Text style={styles.empty}>향후 2주 일정이 없습니다</Text></View>
        ) : (
          days.map((day) => (
            <View key={day} style={{ marginBottom: 14 }}>
              <Text style={styles.dayHeader}>{fmtDay(day)}</Text>
              {byDay[day].map((ev) => {
                const color = ev.color || ev.category?.color || COLORS.primary[500];
                return (
                  <View key={ev.id} style={[styles.eventCard, { borderLeftColor: color }]}>
                    <View style={styles.eventHeader}>
                      <Text style={styles.eventTitle}>{ev.title}</Text>
                      <Text style={styles.eventTime}>{fmtTime(ev.startDate, ev.allDay)}</Text>
                    </View>
                    {ev.location && <Text style={styles.eventMeta}>📍 {ev.location}</Text>}
                    {ev.category && <Text style={styles.eventMeta}>#{ev.category.name}</Text>}
                  </View>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 40 },
  centerBox: { padding: 60, alignItems: 'center' },
  empty: { color: c.textSubtle },
  dayHeader: { fontSize: 13, fontWeight: '700', color: c.text, marginBottom: 6 },
  eventCard: { backgroundColor: c.surface, padding: 12, borderRadius: 12, marginBottom: 6, borderLeftWidth: 4 },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  eventTitle: { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
  eventTime: { fontSize: 12, color: c.textMuted, marginLeft: 8 },
  eventMeta: { fontSize: 11, color: c.textSubtle, marginTop: 3 },
});
