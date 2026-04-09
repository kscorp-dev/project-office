import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { COLORS } from '../../src/constants/theme';

interface ChatRoom {
  id: string;
  name: string;
  lastMessage: string;
  time: string;
  unread: number;
  isGroup: boolean;
  members: number;
}

const DEMO_CHATS: ChatRoom[] = [
  { id: '1', name: '개발팀', lastMessage: '빌드 완료했습니다 👍', time: '09:42', unread: 3, isGroup: true, members: 8 },
  { id: '2', name: '김부장', lastMessage: '오후 회의 시간 변경됐습니다', time: '09:30', unread: 1, isGroup: false, members: 0 },
  { id: '3', name: '프로젝트 A팀', lastMessage: '이대리: 자료 공유합니다', time: '어제', unread: 0, isGroup: true, members: 5 },
  { id: '4', name: '박과장', lastMessage: '확인했습니다. 감사합니다.', time: '어제', unread: 0, isGroup: false, members: 0 },
  { id: '5', name: '전체공지', lastMessage: '4월 교육 일정 안내', time: '4/7', unread: 0, isGroup: true, members: 42 },
];

export default function MessengerScreen() {
  const [search, setSearch] = useState('');

  const filtered = DEMO_CHATS.filter(
    (c) => !search || c.name.includes(search) || c.lastMessage.includes(search)
  );

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

      <ScrollView style={styles.list}>
        {filtered.map((chat) => (
          <TouchableOpacity key={chat.id} style={styles.chatRow} activeOpacity={0.7}>
            {/* 아바타 */}
            <View style={[styles.avatar, chat.isGroup && styles.avatarGroup]}>
              <Text style={styles.avatarText}>
                {chat.isGroup ? `${chat.members}` : chat.name[0]}
              </Text>
            </View>

            {/* 내용 */}
            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={styles.chatName} numberOfLines={1}>
                  {chat.name}
                  {chat.isGroup && <Text style={styles.memberCount}> ({chat.members})</Text>}
                </Text>
                <Text style={styles.chatTime}>{chat.time}</Text>
              </View>
              <Text style={styles.chatMsg} numberOfLines={1}>{chat.lastMessage}</Text>
            </View>

            {/* 안읽음 배지 */}
            {chat.unread > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{chat.unread}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} activeOpacity={0.8}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
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
  fab: {
    position: 'absolute', bottom: 20, right: 20,
    width: 56, height: 56, borderRadius: 18, backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.primary[500], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabText: { fontSize: 28, fontWeight: '300', color: COLORS.white, marginTop: -2 },
});
