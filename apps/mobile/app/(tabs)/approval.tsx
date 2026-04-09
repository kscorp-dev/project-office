import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../../src/constants/theme';

type Tab = 'pending' | 'approved' | 'rejected' | 'mine';

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
  { key: 'mine', label: '내 기안' },
];

interface ApprovalItem {
  id: string;
  title: string;
  author: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
  type: string;
}

const DEMO: ApprovalItem[] = [
  { id: '1', title: '출장 경비 정산 (서울-부산)', author: '이대리', date: '4/9', status: 'pending', type: '경비' },
  { id: '2', title: '사무용품 구매 요청', author: '최사원', date: '4/8', status: 'pending', type: '구매' },
  { id: '3', title: '연차 사용 신청 (4/21)', author: '나', date: '4/7', status: 'approved', type: '휴가' },
  { id: '4', title: '프로젝트 예산 증액 요청', author: '박과장', date: '4/5', status: 'rejected', type: '예산' },
];

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  pending:  { bg: '#fef9c3', text: '#a16207', label: '대기' },
  approved: { bg: '#dcfce7', text: '#15803d', label: '승인' },
  rejected: { bg: '#fef2f2', text: '#dc2626', label: '반려' },
};

export default function ApprovalScreen() {
  const [tab, setTab] = useState<Tab>('pending');

  const filtered = DEMO.filter((d) => {
    if (tab === 'mine') return d.author === '나';
    return d.status === tab;
  });

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

      {/* 통계 */}
      <View style={styles.statsRow}>
        {[
          { label: '대기', count: DEMO.filter((d) => d.status === 'pending').length, color: COLORS.warning },
          { label: '승인', count: DEMO.filter((d) => d.status === 'approved').length, color: COLORS.primary[500] },
          { label: '반려', count: DEMO.filter((d) => d.status === 'rejected').length, color: COLORS.danger },
        ].map((s) => (
          <View key={s.label} style={styles.statItem}>
            <Text style={[styles.statCount, { color: s.color }]}>{s.count}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 목록 */}
      <ScrollView style={styles.list}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>문서가 없습니다</Text>
          </View>
        ) : (
          filtered.map((item) => {
            const st = STATUS_STYLE[item.status];
            return (
              <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.7}>
                <View style={styles.cardHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: COLORS.primary[50] }]}>
                    <Text style={[styles.typeText, { color: COLORS.primary[700] }]}>{item.type}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusText, { color: st.text }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardAuthor}>{item.author}</Text>
                  <Text style={styles.cardDate}>{item.date}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.white, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.gray[200],
  },
  tabActive: { backgroundColor: COLORS.primary[500], borderColor: COLORS.primary[500] },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.gray[500] },
  tabTextActive: { color: COLORS.white },
  statsRow: { flexDirection: 'row', gap: 10, padding: 16 },
  statItem: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 14, padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  statCount: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 11, color: COLORS.gray[500], marginTop: 2 },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: COLORS.gray[400] },
  card: {
    backgroundColor: COLORS.white, borderRadius: 16, padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeText: { fontSize: 11, fontWeight: '600' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '600' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: COLORS.gray[800], marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  cardAuthor: { fontSize: 12, color: COLORS.gray[500] },
  cardDate: { fontSize: 12, color: COLORS.gray[400] },
});
