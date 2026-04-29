/**
 * 메신저 탭 — 오프라인 캐시 우선 + 네트워크 sync.
 *
 * useChatRooms 훅이 SQLite 캐시를 먼저 읽어 즉시 렌더 후 서버 응답으로 갱신한다.
 * 오프라인 상태면 상단에 "오프라인 모드" 배너 표시.
 */
import { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import { useAuthStore } from '../../src/store/auth';
import { useChatRooms, type UiChatRoom } from '../../src/hooks/useChatRooms';

export default function MessengerScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { rooms, loading, isOffline, lastSyncedAt, refresh } = useChatRooms();

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  /** direct 방은 상대방 이름 추론, group 방은 name 또는 참가자 요약 */
  const roomTitle = (r: UiChatRoom): string => {
    if (r.name) return r.name;
    if (r.type === 'direct') {
      const other = r.participants.find((p) => p.id !== currentUserId);
      return other?.name ?? '(대화상대 없음)';
    }
    return r.participants.map((p) => p.name).slice(0, 3).join(', ');
  };

  const roomAvatar = (r: UiChatRoom): string => {
    if (r.type === 'group') return String(r.participants.length);
    return roomTitle(r)[0] ?? '?';
  };

  const fmtTime = (ms: number | null) => {
    if (!ms) return '';
    const d = new Date(ms);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (isYesterday) return '어제';
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const fmtLastSync = (ms: number | null) => {
    if (!ms) return '';
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return '방금 전 동기화';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전 동기화`;
    return `${Math.floor(diff / 3600)}시간 전 동기화`;
  };

  const filtered = rooms.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return roomTitle(r).toLowerCase().includes(q) ||
           (r.lastMessagePreview?.toLowerCase().includes(q) ?? false);
  });

  return (
    <View style={styles.container}>
      {/* 오프라인 배너 */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            📡 오프라인 · 저장된 정보를 표시합니다{lastSyncedAt ? ` · ${fmtLastSync(lastSyncedAt)}` : ''}
          </Text>
        </View>
      )}

      {/* 검색 */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="대화방 검색..."
          placeholderTextColor={COLORS.gray[400]}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary[500]} />}
      >
        {loading && rooms.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={COLORS.primary[500]} />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>대화방이 없습니다</Text>
          </View>
        ) : (
          filtered.map((chat) => {
            const isGroup = chat.type === 'group';
            return (
              <TouchableOpacity
                key={chat.id}
                style={styles.chatRow}
                activeOpacity={0.7}
                onPress={() => router.push(`/messenger/room/${chat.id}` as any)}
              >
                <View style={[styles.avatar, isGroup && styles.avatarGroup]}>
                  <Text style={styles.avatarText}>{roomAvatar(chat)}</Text>
                </View>

                <View style={styles.chatContent}>
                  <View style={styles.chatHeader}>
                    <Text style={styles.chatName} numberOfLines={1}>
                      {roomTitle(chat)}
                      {isGroup && <Text style={styles.memberCount}> ({chat.participants.length})</Text>}
                    </Text>
                    <Text style={styles.chatTime}>{fmtTime(chat.lastMessageAt)}</Text>
                  </View>
                  <Text style={styles.chatMsg} numberOfLines={1}>
                    {chat.lastMessagePreview || '대화 시작'}
                  </Text>
                </View>

                {chat.unreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</Text>
                  </View>
                )}
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
  offlineBanner: {
    backgroundColor: isDark ? '#3a2a08' : '#fef3c7',
    paddingVertical: 8, paddingHorizontal: 16,
  },
  offlineBannerText: {
    fontSize: 12, color: isDark ? '#fcd34d' : '#92400e', textAlign: 'center',
  },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput: {
    backgroundColor: c.surfaceAlt, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, color: c.text, borderWidth: 1, borderColor: c.border,
  },
  list: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: c.textSubtle },
  chatRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  avatarGroup: { backgroundColor: COLORS.primary[400], borderRadius: 14 },
  avatarText: { fontSize: 16, fontWeight: '700', color: COLORS.white },
  chatContent: { flex: 1 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  chatName: { fontSize: 15, fontWeight: '600', color: c.text, flex: 1, marginRight: 8 },
  memberCount: { fontSize: 12, fontWeight: '400', color: c.textSubtle },
  chatTime: { fontSize: 11, color: c.textSubtle },
  chatMsg: { fontSize: 13, color: c.textMuted },
  badge: {
    backgroundColor: COLORS.primary[500], borderRadius: 10, minWidth: 20, height: 20,
    paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center', marginLeft: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: COLORS.white },
});
