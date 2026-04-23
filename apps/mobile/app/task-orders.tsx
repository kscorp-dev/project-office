import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import api from '../src/services/api';

interface TaskOrder {
  id: string;
  taskNumber: string;
  title: string;
  status: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: string | null;
  creator?: { id: string; name: string };
  client?: { id: string; companyName: string } | null;
  progress?: number;
  createdAt: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft:            { label: '임시',    color: '#94a3b8' },
  instructed:       { label: '지시',    color: '#3b82f6' },
  in_progress:      { label: '진행중',  color: '#06b6d4' },
  partial_complete: { label: '부분완료', color: '#f59e0b' },
  work_complete:    { label: '작업완료', color: '#10b981' },
  billing_complete: { label: '청구완료', color: '#14b8a6' },
  final_complete:   { label: '최종완료', color: '#16a34a' },
  discarded:        { label: '폐기',    color: '#ef4444' },
};

const PRIO_LABEL: Record<string, { label: string; color: string }> = {
  low:    { label: '낮음',  color: '#94a3b8' },
  normal: { label: '보통',  color: '#3b82f6' },
  high:   { label: '높음',  color: '#f59e0b' },
  urgent: { label: '긴급',  color: '#ef4444' },
};

export default function TaskOrdersScreen() {
  const [box, setBox] = useState<'all' | 'sent' | 'received'>('all');
  const [items, setItems] = useState<TaskOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/task-orders?box=${box}&limit=50`);
      setItems(res.data?.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, [box]);

  const fmtDate = (iso?: string | null) => iso ? `${new Date(iso).getMonth() + 1}/${new Date(iso).getDate()}` : '-';

  return (
    <>
      <Stack.Screen options={{ title: '작업지시서' }} />
      <View style={styles.container}>
        <View style={styles.tabs}>
          {(['all', 'sent', 'received'] as const).map((b) => (
            <TouchableOpacity key={b} onPress={() => setBox(b)} style={[styles.tab, box === b && styles.tabActive]}>
              <Text style={[styles.tabText, box === b && styles.tabTextActive]}>
                {b === 'all' ? '전체' : b === 'sent' ? '내가 지시' : '받은 지시'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.primary[500]} />
          ) : items.length === 0 ? (
            <Text style={styles.empty}>작업지시서가 없습니다</Text>
          ) : (
            items.map((t) => {
              const st = STATUS_LABEL[t.status] ?? STATUS_LABEL.draft;
              const pr = PRIO_LABEL[t.priority] ?? PRIO_LABEL.normal;
              return (
                <TouchableOpacity key={t.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.taskNumber}>{t.taskNumber}</Text>
                    <View style={[styles.pill, { backgroundColor: st.color + '22' }]}>
                      <Text style={[styles.pillText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.title}>{t.title}</Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.pill, { backgroundColor: pr.color + '22' }]}>
                      <Text style={[styles.pillText, { color: pr.color }]}>{pr.label}</Text>
                    </View>
                    {t.progress !== undefined && (
                      <Text style={styles.meta}>진행 {t.progress}%</Text>
                    )}
                    <Text style={styles.meta}>마감 {fmtDate(t.dueDate)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  tabs: { flexDirection: 'row', padding: 12, gap: 6 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.gray[200] },
  tabActive: { backgroundColor: COLORS.primary[500], borderColor: COLORS.primary[500] },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.gray[500] },
  tabTextActive: { color: COLORS.white },
  empty: { textAlign: 'center', color: COLORS.gray[400], padding: 40 },
  card: { backgroundColor: COLORS.white, padding: 14, borderRadius: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  taskNumber: { fontSize: 11, color: COLORS.gray[400], fontFamily: 'Menlo' },
  title: { fontSize: 15, fontWeight: '600', color: COLORS.gray[800], marginBottom: 8 },
  metaRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText: { fontSize: 10, fontWeight: '700' },
  meta: { fontSize: 11, color: COLORS.gray[500] },
});
