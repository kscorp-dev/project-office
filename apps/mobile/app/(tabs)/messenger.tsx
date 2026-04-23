import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { COLORS } from '../../src/constants/theme';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/store/auth';

interface ChatRoomApi {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  participants: Array<{
    userId: string;
    user: { id: string; name: string; profileImage?: string | null };
  }>;
  lastMessage?: {
    content: string | null;
    type: string;
    createdAt: string;
    sender?: { name: string } | null;
  } | null;
  unreadCount: number;
  updatedAt: string;
}

export default function MessengerScreen() {
  const [search, setSearch] = useState('');
  const [rooms, setRooms] = useState<ChatRoomApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/messenger/rooms');
      setRooms(res.data?.data ?? []);
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error?.message || '대화방 조회 실패');
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRooms();
    setRefreshing(false);
  };

  /** direct 방은 상대방 이름, group 방은 name 또는 참가자 요약 */
  const roomTitle = (r: ChatRoomApi): string => {
    if (r.name) return r.name;
    if (r.type === 'direct') {
      const other = r.participants.find((p) => p.userId !== currentUserId);
      return other?.user.name ?? '(대화상대 없음)';
    }
    return r.participants.map((p) => p.user.name).slice(0, 3).join(', ');
  };

  const roomAvatar = (r: ChatRoomApi): string => {
    if (r.type === 'group') return String(r.participants.length);
    return roomTitle(r)[0] ?? '?';
  };

  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (isYesterday) return '어제';
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const lastMessagePreview = (r: ChatRoomApi): string => {
    if (!r.lastMessage) return '';
    if (r.lastMessage.type === 'image') return '📷 사진';
    if (r.lastMessage.type === 'file') return '📎 파일';
    return r.lastMessage.content ?? '';
  };

  const filtered = rooms.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return roomTitle(r).toLowerCase().includes(q) || lastMessagePreview(r).toLowerCase().includes(q);
  });

  return (
    <View style={styles.container}>
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
        {loading ? (
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
              <TouchableOpacity key={chat.id} style={styles.chatRow} activeOpacity={0.7}>
                <View style={[styles.avatar, isGroup && styles.avatarGroup]}>
                  <Text style={styles.avatarText}>{roomAvatar(chat)}</Text>
                </View>

                <View style={styles.chatContent}>
                  <View style={styles.chatHeader}>
                    <Text style={styles.chatName} numberOfLines={1}>
                      {roomTitle(chat)}
                      {isGroup && <Text style={styles.memberCount}> ({chat.participants.length})</Text>}
                    </Text>
                    <Text style={styles.chatTime}>{fmtTime(chat.lastMessage?.createdAt ?? chat.updatedAt)}</Text>
                  </View>
                  <Text style={styles.chatMsg} numberOfLines={1}>
                    {lastMessagePreview(chat) || '대화 시작'}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput: {
    backgroundColor: COLORS.white, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, color: COLORS.gray[800], borderWidth: 1, borderColor: COLORS.gray[200],
  },
  list: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: COLORS.gray[400] },
  chatRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50],
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
  chatName: { fontSize: 15, fontWeight: '600', color: COLORS.gray[800], flex: 1, marginRight: 8 },
  memberCount: { fontSize: 12, fontWeight: '400', color: COLORS.gray[400] },
  chatTime: { fontSize: 11, color: COLORS.gray[400] },
  chatMsg: { fontSize: 13, color: COLORS.gray[500] },
  badge: {
    backgroundColor: COLORS.primary[500], borderRadius: 10, minWidth: 20, height: 20,
    paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center', marginLeft: 8,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: COLORS.white },
});
