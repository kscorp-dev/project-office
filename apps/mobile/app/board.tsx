import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import api from '../src/services/api';

interface Board {
  id: string;
  name: string;
  description?: string | null;
  _count?: { posts?: number };
}

interface Post {
  id: string;
  title: string;
  createdAt: string;
  isPinned: boolean;
  author: { id: string; name: string };
  board: { id: string; name: string };
  _count?: { comments?: number };
  viewCount: number;
}

export default function BoardScreen() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBoards = async () => {
    try {
      const res = await api.get('/board/boards');
      const list: Board[] = res.data?.data ?? [];
      setBoards(list);
      if (!activeBoardId && list[0]) setActiveBoardId(list[0].id);
    } catch {
      setBoards([]);
    }
  };
  const fetchPosts = async (boardId: string | null) => {
    if (!boardId) { setPosts([]); return; }
    setLoading(true);
    try {
      const res = await api.get(`/board/boards/${boardId}/posts?limit=30`);
      setPosts(res.data?.data ?? []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchBoards(); }, []);
  useEffect(() => { fetchPosts(activeBoardId); }, [activeBoardId]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / (86400 * 1000));
    if (diff === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (diff === 1) return '어제';
    if (diff < 7) return `${diff}일 전`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <>
      <Stack.Screen options={{ title: '게시판' }} />
      <View style={styles.container}>
        {/* 게시판 탭 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}>
          {boards.map((b) => (
            <TouchableOpacity
              key={b.id}
              onPress={() => setActiveBoardId(b.id)}
              style={[styles.tab, activeBoardId === b.id && styles.tabActive]}
            >
              <Text style={[styles.tabText, activeBoardId === b.id && styles.tabTextActive]}>{b.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
            setRefreshing(true);
            await Promise.all([fetchBoards(), fetchPosts(activeBoardId)]);
            setRefreshing(false);
          }} />}
        >
          {loading ? (
            <View style={styles.centerBox}><ActivityIndicator color={COLORS.primary[500]} /></View>
          ) : posts.length === 0 ? (
            <View style={styles.centerBox}><Text style={styles.empty}>글이 없습니다</Text></View>
          ) : (
            posts.map((p) => (
              <TouchableOpacity key={p.id} style={styles.postRow}>
                {p.isPinned && <Text style={styles.pin}>📌</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.postTitle} numberOfLines={1}>{p.title}</Text>
                  <Text style={styles.postMeta}>
                    {p.author.name} · {fmtDate(p.createdAt)} · 조회 {p.viewCount}
                    {p._count?.comments ? ` · 댓글 ${p._count.comments}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  tabs: { maxHeight: 52, paddingVertical: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: COLORS.white, borderRadius: 20, borderWidth: 1, borderColor: COLORS.gray[200] },
  tabActive: { backgroundColor: COLORS.primary[500], borderColor: COLORS.primary[500] },
  tabText: { fontSize: 13, color: COLORS.gray[600], fontWeight: '600' },
  tabTextActive: { color: COLORS.white },
  centerBox: { padding: 60, alignItems: 'center' },
  empty: { color: COLORS.gray[400] },
  postRow: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50], gap: 8 },
  pin: { fontSize: 14 },
  postTitle: { fontSize: 14, fontWeight: '600', color: COLORS.gray[800], marginBottom: 4 },
  postMeta: { fontSize: 11, color: COLORS.gray[400] },
});
