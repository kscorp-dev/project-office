import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';

interface ParkingEvent {
  id: string;
  type: 'entry' | 'exit';
  plateNumber?: string | null;
  createdAt: string;
  zone?: { id: string; name: string; label: string } | null;
}

interface Stats {
  todayEntries: number;
  todayExits: number;
  currentParked: number;
  totalZones: number;
  recentEvents: ParkingEvent[];
}

export default function ParkingScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get('/parking/events/stats');
      setStats(res.data?.data ?? null);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, []);

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <>
      <Stack.Screen options={{ title: '주차관리' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
      >
        {loading && !stats ? (
          <View style={styles.centerBox}><ActivityIndicator color={COLORS.primary[500]} /></View>
        ) : !stats ? (
          <View style={styles.centerBox}><Text style={styles.empty}>주차 데이터가 없습니다</Text></View>
        ) : (
          <>
            {/* 통계 */}
            <View style={styles.statGrid}>
              <StatCell styles={styles} label="현재 주차" value={stats.currentParked} color={COLORS.primary[500]} />
              <StatCell styles={styles} label="오늘 입차" value={stats.todayEntries} color="#10b981" />
              <StatCell styles={styles} label="오늘 출차" value={stats.todayExits} color="#f97316" />
              <StatCell styles={styles} label="구역 수" value={stats.totalZones} color={c.textSubtle} />
            </View>

            <Text style={styles.sectionTitle}>최근 이벤트</Text>
            <View style={styles.card}>
              {stats.recentEvents.length === 0 ? (
                <Text style={styles.empty}>최근 이벤트가 없습니다</Text>
              ) : stats.recentEvents.map((ev) => (
                <View key={ev.id} style={styles.eventRow}>
                  <Text style={[styles.typePill, ev.type === 'entry' ? styles.typeIn : styles.typeOut]}>
                    {ev.type === 'entry' ? '입차' : '출차'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.plate}>{ev.plateNumber || '(번호 인식 실패)'}</Text>
                    <Text style={styles.eventMeta}>
                      {ev.zone?.name ?? '구역 없음'} · {fmtTime(ev.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function StatCell({ label, value, color, styles }: { label: string; value: number; color: string; styles: any }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 40 },
  centerBox: { padding: 60, alignItems: 'center' },
  empty: { color: c.textSubtle, textAlign: 'center', padding: 20 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCell: { width: '47%', backgroundColor: c.surface, padding: 16, borderRadius: 14, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' },
  eventRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 12 },
  typePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontSize: 11, fontWeight: '700' },
  typeIn: { backgroundColor: '#d1fae5', color: '#047857' },
  typeOut: { backgroundColor: '#fed7aa', color: '#c2410c' },
  plate: { fontSize: 14, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: c.text },
  eventMeta: { fontSize: 11, color: c.textSubtle, marginTop: 2 },
});
