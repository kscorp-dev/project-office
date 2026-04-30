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
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image,
  Modal,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, SPACING, RADIUS, type SemanticColors } from '../../../src/constants/theme';
import { useTheme } from '../../../src/hooks/useTheme';
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
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const [roomTitle, setRoomTitle] = useState<string>('대화');
  const [roomType, setRoomType] = useState<string>('direct');
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);

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

  // ── 방 정보 로드 (타이틀 + 타입 + 방장) ──
  const loadRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      // 정확한 멤버 정보를 위해 /rooms/:id 사용 (그룹 룸 멤버 모달도 이걸 호출)
      const res = await api.get(`/messenger/rooms/${roomId}`);
      const room = res.data?.data;
      if (room) {
        setRoomType(room.type ?? 'direct');
        setRoomCreatorId(room.creatorId ?? null);
        if (room.name) {
          setRoomTitle(room.name);
        } else if (room.type === 'direct') {
          const other = (room.members ?? []).find((m: any) => m.userId !== currentUserId);
          setRoomTitle(other?.user?.name ?? '(상대방 없음)');
        } else {
          setRoomTitle(`단체 (${room.members?.length ?? 0})`);
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

  // ── 첨부 업로드 ──
  const uploadAttachment = async (uri: string, fileName: string, mimeType: string) => {
    if (!roomId) return;
    try {
      const form = new FormData();
      // RN 의 FormData 는 file 객체로 { uri, name, type } 형태 허용
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.append('file', { uri, name: fileName, type: mimeType } as any);
      await api.post(`/messenger/rooms/${roomId}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // 서버가 socket message:new 로 푸시 → 자동 반영
    } catch (err: any) {
      Alert.alert('업로드 실패', err.response?.data?.error?.message || '잠시 후 다시 시도해주세요');
    }
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: false,
    });
    if (r.canceled) return;
    const a = r.assets?.[0];
    if (!a) return;
    const ext = (a.fileName || a.uri).split('.').pop()?.toLowerCase() || 'jpg';
    const mime = a.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
    await uploadAttachment(a.uri, a.fileName || `image.${ext}`, mime);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('권한 필요', '카메라 접근 권한이 필요합니다');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (r.canceled) return;
    const a = r.assets?.[0];
    if (!a) return;
    const fileName = a.fileName || `photo-${Date.now()}.jpg`;
    await uploadAttachment(a.uri, fileName, a.mimeType || 'image/jpeg');
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets?.[0];
    if (!a) return;
    await uploadAttachment(a.uri, a.name, a.mimeType || 'application/octet-stream');
  };

  const showAttachmentMenu = () => {
    Alert.alert(
      '첨부',
      '어떤 파일을 보낼까요?',
      [
        { text: '📷 카메라로 촬영', onPress: takePhoto },
        { text: '🖼 사진 라이브러리', onPress: pickImage },
        { text: '📎 파일', onPress: pickFile },
        { text: '취소', style: 'cancel' },
      ],
    );
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
          // 그룹 룸에선 우측 상단에 멤버 아이콘 노출
          headerRight: roomType === 'group' ? () => (
            <TouchableOpacity onPress={() => setShowMembers(true)} style={{ paddingHorizontal: 6 }}>
              <Text style={{ fontSize: 22 }}>👥</Text>
            </TouchableOpacity>
          ) : undefined,
        }}
      />

      {/* 멤버 모달 */}
      {showMembers && (
        <RoomMembersModal
          visible={showMembers}
          roomId={roomId}
          currentUserId={currentUserId ?? ''}
          isCreator={!!currentUserId && roomCreatorId === currentUserId}
          onClose={() => setShowMembers(false)}
          onChanged={loadRoom}
          c={c}
          isDark={isDark}
        />
      )}
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
            onPress={showAttachmentMenu}
          >
            <Text style={styles.attachText}>＋</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={input}
            onChangeText={onChangeText}
            placeholder="메시지 입력..."
            placeholderTextColor={c.placeholder}
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

// ─── 그룹 룸 멤버 관리 모달 ───

interface MemberInfo {
  userId: string;
  joinedAt: string;
  isCreator: boolean;
  user: {
    id: string; name: string; profileImage?: string | null; position?: string | null;
    employeeId?: string | null;
    department?: { name: string | null } | null;
  };
}

interface UserBrief {
  id: string;
  name: string;
  position?: string | null;
  employeeId?: string | null;
  department?: { name: string | null } | null;
}

function RoomMembersModal({
  visible, roomId, currentUserId, isCreator, onClose, onChanged, c, isDark,
}: {
  visible: boolean;
  roomId: string;
  currentUserId: string;
  isCreator: boolean;
  onClose: () => void;
  onChanged: () => void;
  c: SemanticColors;
  isDark: boolean;
}) {
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserBrief[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!roomId) return;
    setLoading(true);
    try {
      const res = await api.get(`/messenger/rooms/${roomId}`);
      setMembers(res.data?.data?.members ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  // 사용자 검색
  useEffect(() => {
    if (!showAdd || !search.trim()) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/users?search=${encodeURIComponent(search.trim())}&limit=10`);
        const list = res.data?.data?.users ?? res.data?.data ?? [];
        const memberIds = new Set(members.map((m) => m.userId));
        setSearchResults(
          (Array.isArray(list) ? list : []).filter((u: UserBrief) => !memberIds.has(u.id)),
        );
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, showAdd, members]);

  const handleAdd = async (user: UserBrief) => {
    setAdding(true);
    try {
      await api.post(`/messenger/rooms/${roomId}/members`, { userIds: [user.id] });
      setSearch('');
      setSearchResults([]);
      await load();
      onChanged();
    } catch (err: any) {
      Alert.alert('실패', err?.response?.data?.error?.message ?? '멤버 추가 실패');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = (m: MemberInfo) => {
    const isSelf = m.userId === currentUserId;
    Alert.alert(
      isSelf ? '대화방 나가기' : '멤버 내보내기',
      isSelf ? '정말 이 대화방을 나가시겠습니까?' : `${m.user.name}님을 내보내시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: isSelf ? '나가기' : '내보내기',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/messenger/rooms/${roomId}/members/${m.userId}`);
              await load();
              onChanged();
              if (isSelf) onClose();
            } catch (err: any) {
              Alert.alert('실패', err?.response?.data?.error?.message ?? '실패');
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[modalStyles.overlay, { backgroundColor: c.scrim }]}>
        <View style={[modalStyles.container, { backgroundColor: c.surface }]}>
          <View style={[modalStyles.header, { borderBottomColor: c.divider }]}>
            <Text style={[modalStyles.title, { color: c.text }]}>참가자 ({members.length})</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ fontSize: 22, color: c.textSubtle }}>×</Text>
            </TouchableOpacity>
          </View>

          {showAdd ? (
            <View style={modalStyles.body}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="이름/사번으로 사용자 검색"
                placeholderTextColor={c.placeholder}
                style={{
                  borderWidth: 1, borderColor: c.border, borderRadius: 10,
                  padding: 12, fontSize: 14, color: c.text, backgroundColor: c.surfaceAlt,
                }}
              />
              <FlatList
                data={searchResults}
                keyExtractor={(u) => u.id}
                style={{ maxHeight: 360, marginTop: 12 }}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  search.trim() && searchResults.length === 0 ? (
                    <Text style={{ textAlign: 'center', padding: 20, color: c.textSubtle }}>
                      검색 결과가 없습니다
                    </Text>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleAdd(item)}
                    disabled={adding}
                    style={{
                      padding: 12, borderRadius: 10, backgroundColor: c.surfaceAlt, marginTop: 8,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>
                      {item.name}
                      {item.position ? <Text style={{ color: c.textSubtle }}> · {item.position}</Text> : null}
                    </Text>
                    <Text style={{ fontSize: 11, color: c.textSubtle, marginTop: 2 }}>
                      {item.employeeId ?? ''} {item.department?.name ? `· ${item.department.name}` : ''}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity
                onPress={() => { setShowAdd(false); setSearch(''); setSearchResults([]); }}
                style={{ marginTop: 16, padding: 12, alignItems: 'center' }}
              >
                <Text style={{ color: c.textMuted, fontSize: 13 }}>← 멤버 목록으로</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={modalStyles.body}>
              {loading ? (
                <ActivityIndicator color={COLORS.primary[500]} />
              ) : (
                <FlatList
                  data={members}
                  keyExtractor={(m) => m.userId}
                  style={{ maxHeight: 400 }}
                  renderItem={({ item }) => {
                    const isSelf = item.userId === currentUserId;
                    const canRemove = isSelf || isCreator;
                    return (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', padding: 12,
                        borderBottomWidth: 1, borderBottomColor: c.divider, gap: 10,
                      }}>
                        <View style={{
                          width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary[500],
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ color: '#ffffff', fontWeight: '700' }}>
                            {item.user.name?.[0] ?? '?'}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>
                            {item.user.name}
                            {item.isCreator && (
                              <Text style={{ fontSize: 10, color: COLORS.primary[600], fontWeight: '700' }}> · 방장</Text>
                            )}
                            {isSelf && (
                              <Text style={{ fontSize: 10, color: c.textSubtle }}> · 나</Text>
                            )}
                          </Text>
                          {(item.user.position || item.user.department?.name) && (
                            <Text style={{ fontSize: 11, color: c.textSubtle }}>
                              {item.user.position ?? ''}
                              {item.user.department?.name ? ` · ${item.user.department.name}` : ''}
                            </Text>
                          )}
                        </View>
                        {canRemove && !item.isCreator && (
                          <TouchableOpacity
                            onPress={() => handleRemove(item)}
                            style={{
                              paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                              backgroundColor: isDark ? '#3a1a1a' : '#fee2e2',
                            }}
                          >
                            <Text style={{ color: '#dc2626', fontSize: 11, fontWeight: '600' }}>
                              {isSelf ? '나가기' : '내보내기'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  }}
                />
              )}
              <TouchableOpacity
                onPress={() => setShowAdd(true)}
                style={{
                  marginTop: 16, padding: 14, borderRadius: 10,
                  backgroundColor: COLORS.primary[500], alignItems: 'center',
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>＋ 멤버 추가</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  container: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 30 : 16, maxHeight: '80%' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '700' },
  body: { padding: 16 },
});

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

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: c.textSubtle, fontSize: 14 },

  offline: {
    backgroundColor: isDark ? '#3a2a08' : '#fef3c7',
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
  },
  offlineText: { fontSize: 11, color: isDark ? '#fcd34d' : '#92400e', textAlign: 'center' },

  listContent: { paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md },

  loadMoreBtn: { alignItems: 'center', padding: SPACING.md },
  loadMoreText: { fontSize: 12, color: COLORS.primary[isDark ? 400 : 600], fontWeight: '600' },

  row: { flexDirection: 'row', marginVertical: 3, gap: 6 },
  rowMe: { justifyContent: 'flex-end', paddingLeft: 40 },
  rowOther: { justifyContent: 'flex-start', paddingRight: 40 },

  systemRow: { alignItems: 'center', paddingVertical: 8 },
  systemText: {
    fontSize: 11, color: c.textMuted,
    backgroundColor: c.surfaceAlt, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 4,
  },

  avatar: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: isDark ? COLORS.primary[800] : COLORS.primary[200],
    justifyContent: 'center', alignItems: 'center',
    alignSelf: 'flex-end',
  },
  avatarText: { color: isDark ? COLORS.primary[200] : COLORS.primary[700], fontWeight: '700' },

  bubble: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16, maxWidth: '80%',
  },
  bubbleMe: {
    backgroundColor: COLORS.primary[isDark ? 600 : 500], borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: c.surface, borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: c.border,
  },
  senderName: { fontSize: 11, fontWeight: '600', color: c.textMuted, marginBottom: 3 },
  msgText: { fontSize: 14, lineHeight: 20 },
  msgTextMe: { color: COLORS.white },
  msgTextOther: { color: c.text },
  msgTime: { fontSize: 9, marginTop: 4, alignSelf: 'flex-end' },
  msgTimeMe: { color: 'rgba(255,255,255,0.75)' },
  msgTimeOther: { color: c.textSubtle },

  image: { width: 200, height: 200, borderRadius: 10, marginBottom: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fileIcon: { fontSize: 16 },

  typing: {
    fontSize: 11, color: c.textMuted,
    paddingHorizontal: SPACING.lg, paddingVertical: 4,
    fontStyle: 'italic',
  },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: SPACING.sm, paddingTop: SPACING.sm,
    backgroundColor: c.surface,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  attachBtn: {
    width: 40, height: 40, borderRadius: RADIUS.pill,
    backgroundColor: c.surfaceAlt,
    justifyContent: 'center', alignItems: 'center',
  },
  attachText: { fontSize: 22, color: c.textMuted, fontWeight: '300' },
  input: {
    flex: 1, minHeight: 40, maxHeight: 100,
    backgroundColor: c.surfaceAlt, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: c.text,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: c.surfaceAlt },
  sendBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700', marginLeft: 2 },
});
