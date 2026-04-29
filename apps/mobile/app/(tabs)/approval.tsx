import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import api from '../../src/services/api';

type Tab = 'pending' | 'approved' | 'rejected' | 'mine';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
  { key: 'mine', label: '내 기안' },
];

interface ApprovalDoc {
  id: string;
  title: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  createdAt: string;
  submittedAt?: string | null;
  drafter?: { id: string; name: string };
  template?: { name: string; category?: string };
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  draft:    { bg: '#f3f4f6', text: '#6b7280', label: '임시' },
  pending:  { bg: '#fef9c3', text: '#a16207', label: '대기' },
  approved: { bg: '#dcfce7', text: '#15803d', label: '승인' },
  rejected: { bg: '#fef2f2', text: '#dc2626', label: '반려' },
};

/** 탭 → 백엔드 box 값 매핑 */
const TAB_TO_BOX: Record<Tab, 'pending' | 'drafts' | 'approved'> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'approved', // 완료함에서 status=rejected 만 필터
  mine: 'drafts',
};

export default function ApprovalScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [tab, setTab] = useState<Tab>('pending');
  const [docs, setDocs] = useState<ApprovalDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const box = TAB_TO_BOX[tab];
      const res = await api.get(`/approvals/documents?box=${box}&limit=50`);
      let list: ApprovalDoc[] = res.data?.data ?? [];
      if (tab === 'approved') list = list.filter((d) => d.status === 'approved');
      if (tab === 'rejected') list = list.filter((d) => d.status === 'rejected');
      setDocs(list);
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error?.message || '문서 조회 실패');
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await api.get('/approvals/count');
      const c = res.data?.data ?? {};
      setCounts({
        pending: c.pending ?? 0,
        approved: c.approved ?? 0,
        rejected: c.rejected ?? 0,
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDocs(), fetchCounts()]);
    setRefreshing(false);
  };

  const fmtDate = (iso?: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <View style={styles.container}>
      {/* 탭 */}
      <View style={styles.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 통계 (백엔드 count 기준) */}
      <View style={styles.statsRow}>
        {[
          { label: '대기', count: counts.pending, color: COLORS.warning },
          { label: '승인', count: counts.approved, color: COLORS.primary[500] },
          { label: '반려', count: counts.rejected, color: COLORS.danger },
        ].map((s) => (
          <View key={s.label} style={styles.statItem}>
            <Text style={[styles.statCount, { color: s.color }]}>{s.count}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 목록 */}
      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary[500]} />}
      >
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={COLORS.primary[500]} />
          </View>
        ) : docs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>문서가 없습니다</Text>
          </View>
        ) : (
          docs.map((item) => {
            const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.draft;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => router.push(`/approval/${item.id}` as any)}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: COLORS.primary[50] }]}>
                    <Text style={[styles.typeText, { color: COLORS.primary[700] }]}>
                      {item.template?.category ?? item.template?.name ?? '일반'}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusText, { color: st.text }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardAuthor}>{item.drafter?.name ?? '-'}</Text>
                  <Text style={styles.cardDate}>{fmtDate(item.submittedAt || item.createdAt)}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: c.surface, alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  tabActive: { backgroundColor: COLORS.primary[500], borderColor: COLORS.primary[500] },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  tabTextActive: { color: COLORS.white },
  statsRow: { flexDirection: 'row', gap: 10, padding: 16 },
  statItem: {
    flex: 1, backgroundColor: c.surface, borderRadius: 14, padding: 12, alignItems: 'center',
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 }),
  },
  statCount: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: c.textSubtle },
  card: {
    backgroundColor: c.surface, borderRadius: 16, padding: 16, marginBottom: 10,
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeText: { fontSize: 11, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '600' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  cardAuthor: { fontSize: 12, color: c.textMuted },
  cardDate: { fontSize: 12, color: c.textSubtle },
});
