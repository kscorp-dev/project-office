import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../src/constants/theme';
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
              <StatCell label="현재 주차" value={stats.currentParked} color={COLORS.primary[500]} />
              <StatCell label="오늘 입차" value={stats.todayEntries} color="#10b981" />
              <StatCell label="오늘 출차" value={stats.todayExits} color="#f97316" />
              <StatCell label="구역 수" value={stats.totalZones} color={COLORS.gray[500]} />
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

function StatCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },
  centerBox: { padding: 60, alignItems: 'center' },
  empty: { color: COLORS.gray[400], textAlign: 'center', padding: 20 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCell: { width: '47%', backgroundColor: COLORS.white, padding: 16, borderRadius: 14, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '700' },
  statLabel: { fontSize: 12, color: COLORS.gray[500], marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.gray[600], marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden' },
  eventRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50], gap: 12 },
  typePill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontSize: 11, fontWeight: '700' },
  typeIn: { backgroundColor: '#d1fae5', color: '#047857' },
  typeOut: { backgroundColor: '#fed7aa', color: '#c2410c' },
  plate: { fontSize: 14, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: COLORS.gray[800] },
  eventMeta: { fontSize: 11, color: COLORS.gray[400], marginTop: 2 },
});
