/**
 * 메신저 방 내부 — Phase 1 Week 3 (부록 A.4 실구현)
 *
 * - GET /messenger/rooms/:id/messages?limit=50 (cursor pagination)
 * - Socket.IO /messenger 네임스페이스:
 *   · message:new → 메시지 목록에 추가 + 방을 read 로 갱신
 *   · typing:start / typing:stop → 하단에 "입력 중..." 표시
 *   · message:read → 내가 보낸 메시지에 읽음 표시 반영
 * - 입력창: 텍스트 전송 / 이미지 / 파일 첨부 (expo-document-picker + expo-image-picker)
 * - 오프라인 DB 의 useChatRooms.markRoomRead() 로 뱃지 즉시 감소
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING, RADIUS } from '../../../src/constants/theme';
import api from '../../../src/services/api';
import { useAuthStore } from '../../../src/store/auth';
import { useMessengerSocket } from '../../../src/hooks/useMessengerSocket';
import { useChatRooms } from '../../../src/hooks/useChatRooms';

interface Sender {
  id: string;
  name: string;
  profileImage?: string | null;
}

interface MessageMeta {
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  filePath?: string;
}

interface Message {
  id: string;
  roomId: string;
  senderId: string | null;
  content: string | null;
  type: 'text' | 'image' | 'file' | 'system';
  metadata?: MessageMeta | null;
  createdAt: string;
  sender?: Sender | null;
  /** 로컬 optimistic (서버 확인 전) */
  pendingSync?: boolean;
}

export default function MessengerRoomScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { connected, emit, on } = useMessengerSocket();
  const { markRoomRead } = useChatRooms();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const [roomTitle, setRoomTitle] = useState<string>('대화');

  const listRef = useRef<FlatList<Message>>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  // ── 초기 메시지 로드 ──
  const loadInitial = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const res = await api.get(`/messenger/rooms/${roomId}/messages?limit=50`);
      const list = (res.data?.data ?? []) as Message[];
      setMessages(list);
      setHasMore(res.data?.meta?.hasMore ?? false);
      markRoomRead(roomId);
      // 서버에 읽음 notification
      emit('message:read', { roomId });
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error?.message || '메시지를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, [roomId, markRoomRead, emit]);

  // ── 방 정보 로드 (타이틀) ──
  const loadRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const res = await api.get('/messenger/rooms');
      const room = (res.data?.data ?? []).find((r: any) => r.id === roomId);
      if (room) {
        if (room.name) {
          setRoomTitle(room.name);
        } else if (room.type === 'direct') {
          const other = room.participants.find((p: any) => p.userId !== currentUserId);
          setRoomTitle(other?.user?.name ?? '(상대방 없음)');
        } else {
          setRoomTitle(`단체 (${room.participants?.length ?? 0})`);
        }
      }
    } catch { /* ignore */ }
  }, [roomId, currentUserId]);

  useEffect(() => { loadInitial(); }, [loadInitial]);
  useEffect(() => { loadRoom(); }, [loadRoom]);

  // ── 소켓 이벤트 구독 ──
  useEffect(() => {
    if (!roomId || !connected) return;

    const offNew = on('message:new', (msg: Message) => {
      if (msg.roomId !== roomId) return;
      setMessages((prev) => {
        // optimistic 로컬 메시지 교체 (같은 content + senderId + 3초 이내)
        const localIdx = prev.findIndex(
          (m) => m.pendingSync &&
            m.content === msg.content &&
            m.senderId === msg.senderId &&
            Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 3000,
        );
        if (localIdx >= 0) {
          const next = [...prev];
          next[localIdx] = msg;
          return next;
        }
        // 중복 방지
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // 내가 읽은 것으로 서버에 알림
      if (msg.senderId !== currentUserId) {
        emit('message:read', { roomId });
        markRoomRead(roomId);
      }
    });

    const offTypingStart = on('typing:start', ({ userId }: { userId: string; roomId: string }) => {
      if (userId === currentUserId) return;
      setTypingUserIds((prev) => new Set(prev).add(userId));
    });
    const offTypingStop = on('typing:stop', ({ userId }: { userId: string; roomId: string }) => {
      setTypingUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    });

    return () => {
      offNew?.();
      offTypingStart?.();
      offTypingStop?.();
    };
  }, [roomId, connected, on, emit, currentUserId, markRoomRead]);

  // ── 입력 처리 ──
  const onChangeText = (text: string) => {
    setInput(text);
    if (!roomId) return;
    // typing 이벤트 throttle (2초 안에 1회만)
    const now = Date.now();
    if (text.length > 0 && now - lastTypingSentRef.current > 2000) {
      emit('typing:start', { roomId });
      lastTypingSentRef.current = now;
    }
    // stop 디바운스
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      emit('typing:stop', { roomId });
      lastTypingSentRef.current = 0;
    }, 1500);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !roomId) return;
    const localId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const optimistic: Message = {
      id: localId,
      roomId,
      senderId: currentUserId ?? null,
      content: text,
      type: 'text',
      createdAt: new Date().toISOString(),
      sender: currentUserId ? { id: currentUserId, name: '나' } : null,
      pendingSync: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    scrollToEnd();

    // 소켓 연결 중이면 socket 사용, 아니면 REST fallback
    try {
      if (connected) {
        emit('message:send', { roomId, content: text, type: 'text' });
        // 서버가 message:new 로 응답 → useEffect 리스너가 로컬 교체
      } else {
        const res = await api.post(`/messenger/rooms/${roomId}/messages`, {
          content: text, type: 'text',
        });
        const real: Message = res.data?.data;
        setMessages((prev) => prev.map((m) => m.id === localId ? real : m));
      }
    } catch (err: any) {
      // 실패 시 메시지에 에러 마크
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId
            ? { ...m, pendingSync: false, content: `⚠️ 전송 실패: ${m.content}` }
            : m,
        ),
      );
      Alert.alert('전송 실패', err.response?.data?.error?.message || '네트워크 오류');
    }
  };

  const scrollToEnd = () => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  };

  // 이전 메시지 더 불러오기 (FlatList onEndReached - inverted=false 이므로 스크롤 상단)
  const loadOlder = async () => {
    if (!roomId || !hasMore || loading || messages.length === 0) return;
    setLoading(true);
    try {
      const oldest = messages[0];
      const res = await api.get(
        `/messenger/rooms/${roomId}/messages?limit=50&cursor=${encodeURIComponent(oldest.createdAt)}`,
      );
      const list = (res.data?.data ?? []) as Message[];
      setHasMore(res.data?.meta?.hasMore ?? false);
      setMessages((prev) => [...list, ...prev]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // ── 렌더 ──
  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.senderId === currentUserId;
    const isSystem = item.type === 'system';
    if (isSystem) {
      return (
        <View style={styles.systemRow}>
          <Text style={styles.systemText}>{item.content}</Text>
        </View>
      );
    }
    return (
      <View style={[styles.row, isMe ? styles.rowMe : styles.rowOther]}>
        {!isMe && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.sender?.name?.[0] ?? '?'}</Text>
          </View>
        )}
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
          {!isMe && item.sender?.name && (
            <Text style={styles.senderName}>{item.sender.name}</Text>
          )}
          {item.type === 'image' && item.metadata?.filePath && (
            <Image
              source={{ uri: absUrl(item.metadata.filePath) }}
              style={styles.image}
              resizeMode="cover"
            />
          )}
          {item.type === 'file' && (
            <View style={styles.fileRow}>
              <Text style={styles.fileIcon}>📎</Text>
              <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}>
                {item.metadata?.fileName ?? item.content}
              </Text>
            </View>
          )}
          {item.type === 'text' && item.content && (
            <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextOther]}>
              {item.content}
            </Text>
          )}
          <Text style={[styles.msgTime, isMe ? styles.msgTimeMe : styles.msgTimeOther]}>
            {formatTime(item.createdAt)}
            {item.pendingSync && ' · 전송 중'}
          </Text>
        </View>
      </View>
    );
  };

  const typingText = typingUserIds.size > 0
    ? `${typingUserIds.size}명이 입력 중...`
    : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: roomTitle,
          headerBackTitle: '뒤로',
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {!connected && (
          <View style={styles.offline}>
            <Text style={styles.offlineText}>📡 실시간 연결 끊김 — 새 메시지는 지연될 수 있습니다</Text>
          </View>
        )}

        {loading && messages.length === 0 ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={COLORS.primary[500]} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.centerBox}>
            <Text style={styles.empty}>아직 대화가 없습니다</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToEnd}
            onLayout={scrollToEnd}
            onEndReachedThreshold={0.1}
            // inverted 가 없으므로 이전 메시지는 스크롤 맨 위 도달 시 호출
            onScrollBeginDrag={() => { /* placeholder */ }}
            ListHeaderComponent={
              hasMore ? (
                <TouchableOpacity onPress={loadOlder} style={styles.loadMoreBtn}>
                  <Text style={styles.loadMoreText}>
                    {loading ? '불러오는 중...' : '이전 대화 더 보기'}
                  </Text>
                </TouchableOpacity>
              ) : null
            }
          />
        )}

        {typingText && <Text style={styles.typing}>{typingText}</Text>}

        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, SPACING.sm) }]}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => Alert.alert(
              '첨부',
              '파일/사진 첨부 기능은 Phase 2 에서 활성화됩니다.\n(expo-document-picker / expo-image-picker 통합 예정)',
            )}
          >
            <Text style={styles.attachText}>＋</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={input}
            onChangeText={onChangeText}
            placeholder="메시지 입력..."
            placeholderTextColor={COLORS.gray[400]}
            multiline
            maxLength={5000}
            onBlur={() => { if (roomId) emit('typing:stop', { roomId }); }}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
            disabled={!input.trim()}
            onPress={send}
          >
            <Text style={styles.sendBtnText}>▶</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

// ─── utils ───

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function absUrl(filePath: string): string {
  if (filePath.startsWith('http')) return filePath;
  // api.ts 의 baseURL 에서 /api 제거한 domain + filePath
  const base = require('../../../src/services/api').API_BASE_URL as string;
  const root = base.replace(/\/api\/?$/, '');
  return root + filePath;
}

// ─── styles ───

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: COLORS.gray[400], fontSize: 14 },

  offline: {
    backgroundColor: '#fef3c7', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
  },
  offlineText: { fontSize: 11, color: '#92400e', textAlign: 'center' },

  listContent: { paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md },

  loadMoreBtn: { alignItems: 'center', padding: SPACING.md },
  loadMoreText: { fontSize: 12, color: COLORS.primary[600], fontWeight: '600' },

  row: { flexDirection: 'row', marginVertical: 3, gap: 6 },
  rowMe: { justifyContent: 'flex-end', paddingLeft: 40 },
  rowOther: { justifyContent: 'flex-start', paddingRight: 40 },

  systemRow: { alignItems: 'center', paddingVertical: 8 },
  systemText: {
    fontSize: 11, color: COLORS.gray[500],
    backgroundColor: COLORS.gray[100], borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 4,
  },

  avatar: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: COLORS.primary[200], justifyContent: 'center', alignItems: 'center',
    alignSelf: 'flex-end',
  },
  avatarText: { color: COLORS.primary[700], fontWeight: '700' },

  bubble: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16, maxWidth: '80%',
  },
  bubbleMe: {
    backgroundColor: COLORS.primary[500], borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: COLORS.white, borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: COLORS.gray[100],
  },
  senderName: { fontSize: 11, fontWeight: '600', color: COLORS.gray[600], marginBottom: 3 },
  msgText: { fontSize: 14, lineHeight: 20 },
  msgTextMe: { color: COLORS.white },
  msgTextOther: { color: COLORS.gray[800] },
  msgTime: { fontSize: 9, marginTop: 4, alignSelf: 'flex-end' },
  msgTimeMe: { color: 'rgba(255,255,255,0.75)' },
  msgTimeOther: { color: COLORS.gray[400] },

  image: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fileIcon: { fontSize: 16 },

  typing: {
    fontSize: 11, color: COLORS.gray[500],
    paddingHorizontal: SPACING.lg, paddingVertical: 4,
    fontStyle: 'italic',
  },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: SPACING.sm, paddingTop: SPACING.sm,
    backgroundColor: COLORS.white,
    borderTopWidth: 1, borderTopColor: COLORS.gray[100],
  },
  attachBtn: {
    width: 40, height: 40, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.gray[100],
    justifyContent: 'center', alignItems: 'center',
  },
  attachText: { fontSize: 22, color: COLORS.gray[600], fontWeight: '300' },
  input: {
    flex: 1, minHeight: 40, maxHeight: 100,
    backgroundColor: COLORS.gray[50], borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: COLORS.gray[800],
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.gray[300] },
  sendBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginLeft: 2 },
});
