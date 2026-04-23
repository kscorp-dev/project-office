/**
 * 모바일 알림 목록 화면 (v0.19.0)
 *
 * 경로: /notifications
 *
 * 기능:
 *   - 페이지네이션 (무한 스크롤)
 *   - 읽음 토글 + 모두 읽음
 *   - 클릭 시 link로 이동 (있으면)
 *   - 아이콘: type별 이모지
 */
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import {
  fetchNotifications, markNotificationAsRead, markAllNotificationsAsRead,
  type Notification,
} from '../src/hooks/useNotifications';

const TYPE_ICONS: Record<string, string> = {
  approval_pending:      '📝',
  approval_approved:     '✅',
  approval_rejected:     '❌',
  approval_recalled:     '↩️',
  approval_reference:    '📄',
  vacation_approved:     '🏖️',
  vacation_rejected:     '🚫',
  message_received:      '💬',
  message_mention:       '@',
  post_must_read:        '📣',
  task_assigned:         '📋',
  task_status_changed:   '🔄',
  meeting_invited:       '🎥',
  meeting_starting_soon: '⏰',
  meeting_minutes_ready: '📑',
  mail_received:         '📧',
  system:                'ℹ️',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Notification[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async (nextPage: number, filter: boolean, append = false) => {
    const result = await fetchNotifications({ page: nextPage, limit: 30, unreadOnly: filter });
    if (append) {
      setRows((prev) => [...prev, ...result.rows]);
    } else {
      setRows(result.rows);
    }
    setPage(result.page);
    setTotalPages(result.totalPages);
  }, []);

  useEffect(() => {
    setLoading(true);
    load(1, unreadOnly).finally(() => setLoading(false));
  }, [unreadOnly, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(1, unreadOnly); }
    finally { setRefreshing(false); }
  }, [load, unreadOnly]);

  const loadMore = useCallback(() => {
    if (page >= totalPages || loading) return;
    void load(page + 1, unreadOnly, true);
  }, [page, totalPages, loading, unreadOnly, load]);

  const handleItemPress = async (n: Notification) => {
    if (!n.isRead) {
      try {
        await markNotificationAsRead(n.id);
        setRows((prev) => prev.map((r) => (r.id === n.id ? { ...r, isRead: true } : r)));
      } catch { /* ignore */ }
    }
    if (n.link) {
      // 웹 경로를 모바일 라우트로 변환 (best effort)
      const path = n.link.startsWith('/') ? n.link : `/${n.link}`;
      // 주요 변환: /meeting/:id → /meeting/[id] (expo-router는 실시간 경로 매칭)
      router.push(path as never);
    }
  };

  const handleMarkAll = () => {
    Alert.alert('모두 읽음 처리', '모든 알림을 읽음 처리할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '확인',
        onPress: async () => {
          await markAllNotificationsAsRead();
          setRows((prev) => prev.map((r) => ({ ...r, isRead: true })));
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '알림' }} />

      {/* 필터 바 */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          onPress={() => setUnreadOnly(false)}
          style={[styles.filterChip, !unreadOnly && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, !unreadOnly && styles.filterTextActive]}>전체</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setUnreadOnly(true)}
          style={[styles.filterChip, unreadOnly && styles.filterChipActive]}
        >
          <Text style={[styles.filterText, unreadOnly && styles.filterTextActive]}>미확인</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={handleMarkAll} style={styles.markAllBtn}>
          <Text style={styles.markAllText}>모두 읽음</Text>
        </TouchableOpacity>
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary[500]} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleItemPress(item)}
              style={[styles.item, !item.isRead && styles.itemUnread]}
              activeOpacity={0.7}
            >
              <View style={styles.itemIcon}>
                <Text style={styles.itemEmoji}>{TYPE_ICONS[item.type] || '🔔'}</Text>
              </View>
              <View style={styles.itemBody}>
                <View style={styles.itemHeader}>
                  <Text style={[styles.itemTitle, !item.isRead && styles.itemTitleUnread]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {!item.isRead && <View style={styles.unreadDot} />}
                </View>
                {item.body && (
                  <Text style={styles.itemBodyText} numberOfLines={2}>
                    {item.body}
                  </Text>
                )}
                <Text style={styles.itemTime}>
                  {new Date(item.createdAt).toLocaleString('ko-KR', {
                    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>
                {unreadOnly ? '미확인 알림이 없습니다' : '알림이 없습니다'}
              </Text>
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary[500]} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          contentContainerStyle={rows.length === 0 ? { flex: 1 } : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.gray[100],
  },
  filterChipActive: { backgroundColor: COLORS.primary[500] },
  filterText: { fontSize: 12, color: COLORS.gray[700], fontWeight: '600' },
  filterTextActive: { color: COLORS.white },

  markAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray[300],
  },
  markAllText: { fontSize: 12, color: COLORS.gray[700] },

  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  item: {
    flexDirection: 'row',
    padding: 14,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  itemUnread: { backgroundColor: COLORS.primary[50] },
  itemIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.gray[100],
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  itemEmoji: { fontSize: 20 },

  itemBody: { flex: 1, minWidth: 0 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemTitle: {
    fontSize: 14,
    color: COLORS.gray[700],
    fontWeight: '500',
    flex: 1,
  },
  itemTitleUnread: { color: COLORS.gray[900], fontWeight: '700' },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.primary[500],
  },
  itemBodyText: {
    fontSize: 13,
    color: COLORS.gray[600],
    marginTop: 3,
    lineHeight: 18,
  },
  itemTime: { fontSize: 11, color: COLORS.gray[400], marginTop: 4 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { fontSize: 48, opacity: 0.3, marginBottom: 8 },
  emptyText: { color: COLORS.gray[400], fontSize: 14 },
});
