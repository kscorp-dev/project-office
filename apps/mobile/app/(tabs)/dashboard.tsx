import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/auth';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import { useNotifications } from '../../src/hooks/useNotifications';
import api from '../../src/services/api';
import AttendanceCheckSheet from '../../src/components/AttendanceCheckSheet';

const QUICK_MENU = [
  { key: 'mail',     label: '메일',     emoji: '✉️',  route: '/(tabs)/mail' },
  { key: 'approval', label: '전자결재', emoji: '📋',  route: '/(tabs)/approval' },
  { key: 'messenger',label: '메신저',   emoji: '💬',  route: '/(tabs)/messenger' },
  { key: 'calendar', label: '캘린더',   emoji: '📅',  route: '/calendar' },
  { key: 'attend',   label: '근태',     emoji: '⏰',  route: '/(tabs)/more' },
  { key: 'board',    label: '게시판',   emoji: '📰',  route: '/(tabs)/more' },
  { key: 'parking',  label: '주차관리', emoji: '🚗',  route: '/(tabs)/more' },
  { key: 'meeting',  label: '화상회의', emoji: '🎥',  route: '/meeting' },
];

interface DashboardSummary {
  pendingApprovals: number;
  delegatedPendingApprovals: number;
  unreadMessages: number;
  unreadNotifications: number;
  todayEvents: number;
  myActiveTasks: number;
  attendance: { checkedIn: boolean; checkInAt: string | null };
  delegations: Array<{ fromUserId: string; fromUserName: string }>;
}

export default function DashboardScreen() {
  const { user } = useAuthStore();
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [refreshing, setRefreshing] = useState(false);
  const { unreadCount } = useNotifications();
  const [today, setToday] = useState<{ checkIn?: any; checkOut?: any } | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [checkSheet, setCheckSheet] = useState<{ open: boolean; type: 'check_in' | 'check_out' } | null>(null);

  const fetchAll = useCallback(async () => {
    // 통합 stats + 상세 attendance 를 병렬 호출 (round-trip 절감)
    const [todayRes, summaryRes] = await Promise.allSettled([
      api.get('/attendance/today'),
      api.get('/dashboard/summary'),
    ]);
    if (todayRes.status === 'fulfilled') setToday(todayRes.value.data?.data ?? null);
    if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value.data?.data ?? null);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

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
        {/* 알림 종 */}
        <TouchableOpacity
          onPress={() => router.push('/notifications')}
          style={styles.bell}
          activeOpacity={0.7}
        >
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* 오늘 요약 — 4개 카드 (실데이터) */}
      <View style={styles.summaryRow}>
        {[
          {
            key: 'event',
            label: '일정',
            value: summary?.todayEvents ?? 0,
            color: COLORS.primary[500],
            route: '/calendar',
          },
          {
            key: 'msg',
            label: '메시지',
            value: summary?.unreadMessages ?? 0,
            color: COLORS.info,
            route: '/(tabs)/messenger',
          },
          {
            key: 'approval',
            label: '결재',
            value: (summary?.pendingApprovals ?? 0) + (summary?.delegatedPendingApprovals ?? 0),
            color: COLORS.warning,
            route: '/(tabs)/approval',
          },
          {
            key: 'task',
            label: '작업',
            value: summary?.myActiveTasks ?? 0,
            color: c.textMuted,
            route: '/task-orders',
          },
        ].map((s) => (
          <TouchableOpacity
            key={s.key}
            onPress={() => router.push(s.route as any)}
            activeOpacity={0.7}
            style={styles.summaryItem}
          >
            <Text style={[styles.summaryValue, { color: s.color }]}>{s.value}건</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 위임 받은 결재 알림 (있을 때만) */}
      {summary && summary.delegations.length > 0 && (
        <TouchableOpacity
          style={styles.delegationBanner}
          onPress={() => router.push('/(tabs)/approval' as any)}
          activeOpacity={0.7}
        >
          <Text style={styles.delegationIcon}>🔁</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.delegationTitle}>
              {summary.delegations.map((d) => d.fromUserName).join(', ')}님으로부터 결재 위임 받음
            </Text>
            {summary.delegatedPendingApprovals > 0 && (
              <Text style={styles.delegationSub}>
                위임받은 대기 결재 {summary.delegatedPendingApprovals}건
              </Text>
            )}
          </View>
        </TouchableOpacity>
      )}

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
          <TouchableOpacity
            style={[styles.attendBtnIn, today?.checkIn && styles.attendBtnDone]}
            activeOpacity={0.8}
            onPress={() => setCheckSheet({ open: true, type: 'check_in' })}
            disabled={!!today?.checkIn}
          >
            <Text style={styles.attendBtnText}>
              {today?.checkIn ? '출근 완료' : '출근'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attendBtnOut, today?.checkOut && styles.attendBtnDone]}
            activeOpacity={0.8}
            onPress={() => setCheckSheet({ open: true, type: 'check_out' })}
            disabled={!today?.checkIn || !!today?.checkOut}
          >
            <Text style={styles.attendBtnOutText}>
              {today?.checkOut ? '퇴근 완료' : '퇴근'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* GPS 출퇴근 시트 */}
      {checkSheet && (
        <AttendanceCheckSheet
          visible={checkSheet.open}
          type={checkSheet.type}
          onClose={() => setCheckSheet(null)}
          onSuccess={() => { fetchAll(); setCheckSheet(null); }}
        />
      )}

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

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 32 },

  greetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }),
  },
  avatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  avatarText: { fontSize: 22, fontWeight: '700', color: COLORS.white },
  greetInfo: { flex: 1 },
  greetHello: { fontSize: 13, color: c.textMuted },
  greetName: { fontSize: 20, fontWeight: '700', color: c.text, marginTop: 2 },
  greetDept: { fontSize: 12, color: c.textSubtle, marginTop: 2 },

  summaryRow: {
    flexDirection: 'row', gap: 10, marginBottom: 24,
  },
  summaryItem: {
    flex: 1, backgroundColor: c.surface, borderRadius: 16, padding: 14, alignItems: 'center',
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }),
  },
  summaryValue: { fontSize: 18, fontWeight: '700' },
  summaryLabel: { fontSize: 11, color: c.textMuted, marginTop: 4 },

  delegationBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: isDark ? '#3a2a08' : '#fef3c7',
    borderRadius: 14, padding: 14, marginBottom: 20,
    borderWidth: 1, borderColor: isDark ? '#5a4112' : '#fcd34d',
  },
  delegationIcon: { fontSize: 22 },
  delegationTitle: { fontSize: 13, fontWeight: '600', color: isDark ? '#fbbf24' : '#92400e' },
  delegationSub: { fontSize: 11, color: isDark ? '#d4a44a' : '#a16207', marginTop: 2 },

  sectionTitle: {
    fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12,
  },

  quickGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24,
  },
  quickItem: {
    width: '23%' as any, backgroundColor: c.surface, borderRadius: 16, padding: 14,
    alignItems: 'center',
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 }),
  },
  quickEmoji: { fontSize: 24, marginBottom: 6 },
  quickLabel: { fontSize: 11, fontWeight: '600', color: c.text },

  attendCard: {
    backgroundColor: c.surface, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 24,
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }),
  },
  attendTime: { fontSize: 36, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  attendDate: { fontSize: 13, color: c.textSubtle, marginTop: 4, marginBottom: 20 },
  attendBtnRow: { flexDirection: 'row', gap: 12, width: '100%' },
  attendBtnIn: {
    flex: 1, backgroundColor: COLORS.primary[500], borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  attendBtnOut: {
    flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : {}),
  },
  attendBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  attendBtnOutText: { color: c.textMuted, fontSize: 15, fontWeight: '700' },
  attendBtnDone: { opacity: 0.55 },

  noticeCard: {
    backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden',
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 }),
  },
  noticeRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 10 },
  noticeBorder: { borderBottomWidth: 1, borderBottomColor: c.divider },
  noticeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary[400] },
  noticeText: { flex: 1, fontSize: 14, color: c.text },

  // 알림 종
  bell: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.surfaceAlt,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  bellIcon: { fontSize: 20 },
  bellBadge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: '#ef4444',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.surface,
  },
  bellBadgeText: { color: COLORS.white, fontSize: 9, fontWeight: '700' },
});
