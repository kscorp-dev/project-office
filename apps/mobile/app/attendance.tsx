import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';
import AttendanceCheckSheet from '../src/components/AttendanceCheckSheet';

interface AttRecord {
  id: string;
  type: 'check_in' | 'check_out';
  checkTime: string;
  note?: string | null;
}

interface MonthRow { date: string; checkIn?: string | null; checkOut?: string | null; }

export default function AttendanceScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [today, setToday] = useState<{ checkInAt?: string | null; checkOutAt?: string | null } | null>(null);
  const [month, setMonth] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkSheet, setCheckSheet] = useState<{ open: boolean; type: 'check_in' | 'check_out' } | null>(null);

  const fetch = async () => {
    setLoading(true);
    try {
      // 백엔드 /attendance/today 는 { checkIn, checkOut, workHours } 형태
      const [tRes, mRes] = await Promise.all([
        api.get('/attendance/today'),
        api.get('/attendance/monthly'),
      ]);
      const t = tRes.data?.data;
      setToday({
        checkInAt: t?.checkIn?.checkTime ?? null,
        checkOutAt: t?.checkOut?.checkTime ?? null,
      });
      setMonth(mRes.data?.data ?? []);
    } catch {
      setToday(null);
      setMonth([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const fmtTime = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';

  return (
    <>
      <Stack.Screen options={{ title: '근무관리' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
      >
        {/* 오늘 카드 */}
        <View style={styles.todayCard}>
          <Text style={styles.todayTitle}>오늘</Text>
          {loading ? <ActivityIndicator /> : (
            <View style={styles.todayGrid}>
              <View style={styles.todayCell}>
                <Text style={styles.cellLabel}>출근</Text>
                <Text style={styles.cellValue}>{fmtTime(today?.checkInAt)}</Text>
              </View>
              <View style={styles.todayCell}>
                <Text style={styles.cellLabel}>퇴근</Text>
                <Text style={styles.cellValue}>{fmtTime(today?.checkOutAt)}</Text>
              </View>
            </View>
          )}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: COLORS.primary[500] }, !!today?.checkInAt && { opacity: 0.5 }]}
              onPress={() => setCheckSheet({ open: true, type: 'check_in' })}
              disabled={!!today?.checkInAt}
            >
              <Text style={styles.btnText}>{today?.checkInAt ? '출근 완료' : '출근'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#f97316' }, (!today?.checkInAt || !!today?.checkOutAt) && { opacity: 0.5 }]}
              onPress={() => setCheckSheet({ open: true, type: 'check_out' })}
              disabled={!today?.checkInAt || !!today?.checkOutAt}
            >
              <Text style={styles.btnText}>{today?.checkOutAt ? '퇴근 완료' : '퇴근'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* GPS 출퇴근 시트 */}
        {checkSheet && (
          <AttendanceCheckSheet
            visible={checkSheet.open}
            type={checkSheet.type}
            onClose={() => setCheckSheet(null)}
            onSuccess={() => { fetch(); setCheckSheet(null); }}
          />
        )}

        {/* 이번 달 */}
        <Text style={styles.sectionTitle}>이번 달 ({month.length}일)</Text>
        <View style={styles.card}>
          {month.length === 0 ? <Text style={styles.empty}>기록 없음</Text> : month.map((row) => (
            <View key={row.date} style={styles.monthRow}>
              <Text style={styles.monthDate}>{row.date.slice(5)}</Text>
              <Text style={styles.monthTime}>출 {fmtTime(row.checkIn)}</Text>
              <Text style={styles.monthTime}>퇴 {fmtTime(row.checkOut)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 40 },
  todayCard: { backgroundColor: c.surface, borderRadius: 18, padding: 20 },
  todayTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12, color: c.text },
  todayGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  todayCell: { flex: 1, padding: 14, backgroundColor: COLORS.primary[50], borderRadius: 12, alignItems: 'center' },
  cellLabel: { fontSize: 12, color: c.textMuted },
  cellValue: { fontSize: 22, fontWeight: '700', color: COLORS.primary[700], marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginTop: 20, marginBottom: 8 },
  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' },
  empty: { padding: 24, textAlign: 'center', color: c.textSubtle },
  monthRow: { flexDirection: 'row', padding: 12, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 12 },
  monthDate: { width: 50, fontWeight: '600', color: c.text },
  monthTime: { flex: 1, color: c.textMuted, fontSize: 13 },
});
