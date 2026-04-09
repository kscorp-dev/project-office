import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/auth';
import { COLORS } from '../../src/constants/theme';

const QUICK_MENU = [
  { key: 'mail',     label: '메일',     emoji: '✉️',  route: '/(tabs)/mail' },
  { key: 'approval', label: '전자결재', emoji: '📋',  route: '/(tabs)/approval' },
  { key: 'messenger',label: '메신저',   emoji: '💬',  route: '/(tabs)/messenger' },
  { key: 'calendar', label: '캘린더',   emoji: '📅',  route: '/(tabs)/more' },
  { key: 'attend',   label: '근태',     emoji: '⏰',  route: '/(tabs)/more' },
  { key: 'board',    label: '게시판',   emoji: '📰',  route: '/(tabs)/more' },
  { key: 'parking',  label: '주차관리', emoji: '🚗',  route: '/(tabs)/more' },
  { key: 'meeting',  label: '화상회의', emoji: '🎥',  route: '/(tabs)/more' },
];

export default function DashboardScreen() {
  const { user } = useAuthStore();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 1000));
    setRefreshing(false);
  }, []);

  const now = new Date();
  const greeting = now.getHours() < 12 ? '좋은 아침이에요' : now.getHours() < 18 ? '좋은 오후에요' : '좋은 저녁이에요';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary[500]} />}
    >
      {/* 인사 & 프로필 */}
      <View style={styles.greetCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.[0] || 'U'}</Text>
        </View>
        <View style={styles.greetInfo}>
          <Text style={styles.greetHello}>{greeting} 👋</Text>
          <Text style={styles.greetName}>{user?.name || '사용자'}님</Text>
          <Text style={styles.greetDept}>{user?.department?.name || user?.position || '(주)KS코퍼레이션'}</Text>
        </View>
      </View>

      {/* 오늘 요약 */}
      <View style={styles.summaryRow}>
        {[
          { label: '일정', value: '0건', color: COLORS.primary[500] },
          { label: '메일', value: '2건', color: COLORS.info },
          { label: '결재', value: '0건', color: COLORS.warning },
          { label: '작업', value: '0건', color: COLORS.gray[500] },
        ].map((s) => (
          <View key={s.label} style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* 바로가기 */}
      <Text style={styles.sectionTitle}>바로가기</Text>
      <View style={styles.quickGrid}>
        {QUICK_MENU.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.quickItem}
            onPress={() => router.push(item.route as any)}
            activeOpacity={0.7}
          >
            <Text style={styles.quickEmoji}>{item.emoji}</Text>
            <Text style={styles.quickLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 근태 체크 */}
      <Text style={styles.sectionTitle}>근무 체크</Text>
      <View style={styles.attendCard}>
        <Text style={styles.attendTime}>
          {now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Text style={styles.attendDate}>
          {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </Text>
        <View style={styles.attendBtnRow}>
          <TouchableOpacity style={styles.attendBtnIn} activeOpacity={0.8}>
            <Text style={styles.attendBtnText}>출근</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attendBtnOut} activeOpacity={0.8}>
            <Text style={styles.attendBtnOutText}>퇴근</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 공지사항 */}
      <Text style={styles.sectionTitle}>최근 공지</Text>
      <View style={styles.noticeCard}>
        {[
          '4월 프로젝트 진행 현황 보고 요청',
          '신입사원 교육 일정 안내 (4/14~18)',
          '자재관리 시스템 v2.1 업데이트',
        ].map((text, i) => (
          <View key={i} style={[styles.noticeRow, i < 2 && styles.noticeBorder]}>
            <View style={styles.noticeDot} />
            <Text style={styles.noticeText} numberOfLines={1}>{text}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 32 },

  greetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText: { fontSize: 22, fontWeight: '700', color: COLORS.white },
  greetInfo: { flex: 1 },
  greetHello: { fontSize: 13, color: COLORS.gray[500] },
  greetName: { fontSize: 20, fontWeight: '700', color: COLORS.gray[800], marginTop: 2 },
  greetDept: { fontSize: 12, color: COLORS.gray[400], marginTop: 2 },

  summaryRow: {
    flexDirection: 'row', gap: 10, marginBottom: 24,
  },
  summaryItem: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 16, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  summaryValue: { fontSize: 18, fontWeight: '700' },
  summaryLabel: { fontSize: 11, color: COLORS.gray[500], marginTop: 4 },

  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: COLORS.gray[800], marginBottom: 12,
  },

  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24,
  },
  quickItem: {
    width: '23%' as any, backgroundColor: COLORS.white, borderRadius: 16, padding: 14,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  quickEmoji: { fontSize: 24, marginBottom: 6 },
  quickLabel: { fontSize: 11, fontWeight: '600', color: COLORS.gray[700] },

  attendCard: {
    backgroundColor: COLORS.white, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  attendTime: { fontSize: 36, fontWeight: '700', color: COLORS.gray[800], fontVariant: ['tabular-nums'] },
  attendDate: { fontSize: 13, color: COLORS.gray[400], marginTop: 4, marginBottom: 20 },
  attendBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  attendBtnIn: {
    flex: 1, backgroundColor: COLORS.primary[500], borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  attendBtnOut: {
    flex: 1, backgroundColor: COLORS.gray[100], borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  attendBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  attendBtnOutText: { color: COLORS.gray[500], fontSize: 15, fontWeight: '700' },

  noticeCard: {
    backgroundColor: COLORS.white, borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  noticeRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  noticeBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.gray[100] },
  noticeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary[400] },
  noticeText: { flex: 1, fontSize: 14, color: COLORS.gray[700] },
});
