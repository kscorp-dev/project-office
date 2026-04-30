import { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  FlatList, TextInput, Platform, StatusBar as RNStatusBar,
  Modal, KeyboardAvoidingView, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import Constants from 'expo-constants';
import { COLORS } from '../../../src/constants/theme';
import { useTheme } from '../../../src/hooks/useTheme';
import { api } from '../../../src/services/api';
import { useAuthStore } from '../../../src/store/auth';

const { width, height } = Dimensions.get('window');

/**
 * 런타임에서 실제 WebRTC 사용 가능 여부 판단
 *
 * - Expo Go 환경: native 모듈 없음 → UI 프리뷰 모드
 * - EAS Dev Client / Production: native 모듈 존재 → 실제 영상/음성 연결
 *
 * Metro 번들러가 require를 항상 정적 분석하므로 module 자체는 번들에 포함되지만,
 * Expo Go에서 native bridge 호출이 없으면 에러는 나지 않는다.
 */
const IS_DEV_CLIENT = Constants.appOwnership !== 'expo';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RTCView: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let useWebRTCMobileHook: any = null;
if (IS_DEV_CLIENT) {
  try {
    RTCView = require('react-native-webrtc').RTCView;
    useWebRTCMobileHook = require('../../../src/hooks/useWebRTCMobile').useWebRTCMobile;
  } catch {
    // Dev client인데 빌드에 네이티브 모듈 아직 없음 → 프리뷰 유지
  }
}
const WEBRTC_AVAILABLE = !!(RTCView && useWebRTCMobileHook);

// Socket.IO URL = API base에서 /api 제거
// (src/services/api.ts의 BASE_URL과 동일 정책)
const API_BASE = ((require('../../../src/services/api') as { API_BASE_URL?: string }).API_BASE_URL)
  || 'http://10.0.2.2:3000/api';
const SOCKET_URL = API_BASE.replace(/\/api\/?$/, '');

interface Participant {
  socketId: string;
  userId: string;
  name: string;
  position?: string;
  isHost: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  /** 로컬 전용 — 자기 자신 플래그 */
  isLocal?: boolean;
}

interface ChatMessage {
  id: string;
  name: string;
  userId: string;
  message: string;
  timestamp: string;
  isLocal: boolean;
}

export default function MeetingRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const [meetingTitle, setMeetingTitle] = useState<string>('회의실');
  const [connecting, setConnecting] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);

  // 미디어 상태
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [frontCamera, setFrontCamera] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);

  // 실제 WebRTC 훅 (dev client에서만 활성)
  // eslint-disable-next-line react-hooks/rules-of-hooks -- 조건부 훅이지만 IS_DEV_CLIENT는 런타임 고정값
  const rtc = WEBRTC_AVAILABLE
    ? useWebRTCMobileHook({ meetingId: id, socketUrl: SOCKET_URL })
    : null;

  // 채팅 (목업 — 실제 채팅은 rtc.socket으로 후속 연결)
  const [chatVisible, setChatVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // 경과 시간 타이머
  useEffect(() => {
    const iv = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // 회의 정보 로드
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/meeting/${id}`);
        setMeetingTitle(data.data?.title || '회의실');
      } catch { /* ignore */ }
      setConnecting(false);
    })();
  }, [id]);

  const handleLeave = () => {
    Alert.alert('회의 나가기', '회의에서 나가시겠습니까?', [
      { text: '취소', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const sendChatMessage = () => {
    const text = chatInput.trim();
    if (!text || !currentUser) return;
    const msg: ChatMessage = {
      id: `local-${Date.now()}`,
      name: currentUser.name,
      userId: currentUser.id,
      message: text,
      timestamp: new Date().toISOString(),
      isLocal: true,
    };
    setMessages((m) => [...m, msg]);
    setChatInput('');
  };

  const fmtTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
      : `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  /* ── 참가자 목록 계산 ──
   * - 로컬: currentUser + 현재 mic/cam 상태
   * - 원격: WebRTC 활성 시 rtc.remotePeers, 아니면 빈 배열 (프리뷰 모드는 혼자)
   */
  const localParticipant: Participant | undefined = currentUser ? {
    socketId: 'self',
    userId: currentUser.id,
    name: currentUser.name,
    position: currentUser.position,
    isHost: false,
    isMuted: !micOn,
    isVideoOff: !camOn,
    isLocal: true,
  } : undefined;

  const remoteParticipants: Participant[] = (WEBRTC_AVAILABLE && rtc)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (rtc.remotePeers as any[]).map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        name: p.name,
        position: p.position,
        isHost: p.isHost,
        isMuted: p.isMuted,
        isVideoOff: p.isVideoOff,
        isLocal: false,
      }))
    : [];

  const totalCount = (localParticipant ? 1 : 0) + remoteParticipants.length;

  // 참가자에 해당하는 MediaStream 찾기 (rtc 활성 시에만 의미 있음)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamOf = (p: Participant): any | null => {
    if (!WEBRTC_AVAILABLE || !rtc) return null;
    if (p.isLocal) return rtc.localStream ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remote = (rtc.remotePeers as any[]).find((rp) => rp.socketId === p.socketId);
    return remote?.stream ?? null;
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      {/* 상단 바 */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleLeave} style={styles.topBtn}>
          <Text style={styles.leaveIcon}>✕</Text>
        </TouchableOpacity>
        <View style={styles.topCenter}>
          <Text style={styles.topTitle} numberOfLines={1}>{meetingTitle}</Text>
          <View style={styles.topMetaRow}>
            <View style={styles.liveDot} />
            <Text style={styles.topMeta}>{fmtTime(elapsedSec)}</Text>
            <Text style={styles.topSep}>·</Text>
            <Text style={styles.topMeta}>{totalCount}명</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => {
            setFrontCamera((v) => !v);
            rtc?.switchCamera();
          }}
          style={styles.topBtn}
        >
          <Text style={styles.topIcon}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* 메인 — 영상 그리드 */}
      <View style={styles.videoArea}>
        {connecting ? (
          <ConnectingOverlay />
        ) : remoteParticipants.length === 0 ? (
          // 혼자 있을 때 — 내 영상 풀스크린
          <FullVideoTile
            participant={localParticipant}
            front={frontCamera}
            screenSharing={screenSharing}
            stream={localParticipant ? streamOf(localParticipant) : null}
          />
        ) : (
          // 2명 이상 — 그리드
          <VideoGrid
            local={localParticipant}
            remotes={remoteParticipants}
            front={frontCamera}
            streamOf={streamOf}
          />
        )}

        {/* 모드 안내 배너 — 실제 연결 vs 프리뷰 */}
        {!connecting && (
          <View style={[styles.devNotice, WEBRTC_AVAILABLE && styles.devNoticeLive]}>
            <Text style={[styles.devNoticeText, WEBRTC_AVAILABLE && styles.devNoticeTextLive]}>
              {WEBRTC_AVAILABLE
                ? (rtc?.connected
                  ? `🟢 실시간 연결됨 · 원격 ${rtc.remotePeers.length}명`
                  : '⚪ WebRTC 연결 시도 중...')
                : '📱 WebRTC native 모듈 미탑재 — UI 프리뷰 모드\n(EAS Dev Client 빌드 시 실스트림 활성)'}
            </Text>
            {rtc?.error && (
              <Text style={[styles.devNoticeText, { color: '#fca5a5', marginTop: 4 }]}>
                ⚠ {rtc.error}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* 하단 컨트롤 바 */}
      <View style={styles.bottomBar}>
        <CtrlBtn
          icon={micOn ? '🎤' : '🔇'}
          label={micOn ? '음소거' : '음성 켜기'}
          active={!micOn}
          onPress={() => {
            setMicOn((v) => !v);
            rtc?.toggleMic();
          }}
        />
        <CtrlBtn
          icon={camOn ? '📹' : '🚫'}
          label={camOn ? '카메라 끄기' : '카메라 켜기'}
          active={!camOn}
          onPress={() => {
            setCamOn((v) => !v);
            rtc?.toggleCam();
          }}
        />
        <CtrlBtn
          icon={screenSharing ? '🖥️' : '📲'}
          label={screenSharing ? '공유 중지' : '화면 공유'}
          active={screenSharing}
          onPress={() => setScreenSharing((v) => !v)}
        />
        <CtrlBtn
          icon="💬"
          label="채팅"
          badge={messages.length > 0 ? messages.length : undefined}
          onPress={() => setChatVisible(true)}
        />
        <CtrlBtn
          icon="📞"
          label="나가기"
          danger
          onPress={handleLeave}
        />
      </View>

      {/* 채팅 모달 */}
      <ChatBottomSheet
        visible={chatVisible}
        onClose={() => setChatVisible(false)}
        messages={messages}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={sendChatMessage}
      />
    </View>
  );
}

/* ───────── Sub Components ───────── */

function ConnectingOverlay() {
  return (
    <View style={styles.connectingOverlay}>
      <Text style={styles.connectingIcon}>🎥</Text>
      <Text style={styles.connectingText}>회의실 연결 중...</Text>
    </View>
  );
}

function FullVideoTile({
  participant, front, screenSharing, stream,
}: {
  participant?: Participant;
  front: boolean;
  screenSharing: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream?: any | null;
}) {
  if (!participant) return null;
  const initial = (participant.name?.[0] || '?').toUpperCase();
  const hasLiveVideo = !!(WEBRTC_AVAILABLE && RTCView && stream && !participant.isVideoOff);
  return (
    <View style={styles.fullTile}>
      {participant.isVideoOff ? (
        <View style={styles.videoOff}>
          <View style={styles.bigAvatar}>
            <Text style={styles.bigAvatarText}>{initial}</Text>
          </View>
          <Text style={styles.videoOffName}>{participant.name}</Text>
          <Text style={styles.videoOffSub}>카메라가 꺼져 있습니다</Text>
        </View>
      ) : hasLiveVideo ? (
        <RTCView
          streamURL={stream.toURL()}
          objectFit="cover"
          mirror={participant.isLocal && front}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.cameraIcon}>📷</Text>
          <Text style={styles.cameraText}>{front ? '전면' : '후면'} 카메라</Text>
          {screenSharing && <Text style={styles.cameraSub}>+ 화면 공유 활성</Text>}
        </View>
      )}
      <View style={styles.nameTag}>
        <Text style={styles.nameTagText}>
          {participant.name}{participant.isLocal ? ' (나)' : ''}
        </Text>
        {participant.isMuted && <Text style={styles.nameTagMute}>🔇</Text>}
      </View>
    </View>
  );
}

function VideoGrid({
  local, remotes, front, streamOf,
}: {
  local?: Participant;
  remotes: Participant[];
  front: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamOf: (p: Participant) => any | null;
}) {
  const all = local ? [local, ...remotes] : remotes;
  const cols = all.length === 1 ? 1 : 2;
  const tileWidth = (width - 24 - (cols - 1) * 8) / cols;
  const tileHeight = tileWidth * 1.2;

  return (
    <FlatList
      data={all}
      keyExtractor={(p) => p.socketId}
      numColumns={cols}
      key={cols}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      columnWrapperStyle={cols > 1 ? { gap: 8 } : undefined}
      renderItem={({ item }) => (
        <VideoTile
          participant={item}
          width={tileWidth}
          height={tileHeight}
          front={front}
          stream={streamOf(item)}
        />
      )}
    />
  );
}

function VideoTile({
  participant, width: w, height: h, front, stream,
}: {
  participant: Participant;
  width: number;
  height: number;
  front: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream?: any | null;
}) {
  const initial = (participant.name?.[0] || '?').toUpperCase();
  const hasLiveVideo = !!(WEBRTC_AVAILABLE && RTCView && stream && !participant.isVideoOff);
  return (
    <View style={[styles.gridTile, { width: w, height: h }]}>
      {participant.isVideoOff ? (
        <View style={styles.videoOff}>
          <View style={styles.gridAvatar}>
            <Text style={styles.gridAvatarText}>{initial}</Text>
          </View>
        </View>
      ) : hasLiveVideo ? (
        <RTCView
          streamURL={stream.toURL()}
          objectFit="cover"
          mirror={participant.isLocal && front}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.cameraPlaceholder}>
          <Text style={styles.cameraIconSmall}>📷</Text>
          {participant.isLocal && <Text style={styles.cameraSubSmall}>{front ? '전면' : '후면'}</Text>}
        </View>
      )}
      <View style={styles.gridNameTag}>
        <Text style={styles.gridNameText} numberOfLines={1}>
          {participant.name}{participant.isLocal ? ' (나)' : ''}
        </Text>
        <View style={styles.gridIcons}>
          {participant.isHost && <Text style={styles.hostIcon}>👑</Text>}
          {participant.isMuted && <Text style={styles.muteIcon}>🔇</Text>}
        </View>
      </View>
    </View>
  );
}

function CtrlBtn({
  icon, label, active, danger, badge, onPress,
}: {
  icon: string; label: string; active?: boolean; danger?: boolean;
  badge?: number; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.ctrlBtn} activeOpacity={0.7}>
      <View style={[
        styles.ctrlIconWrap,
        active && styles.ctrlIconActive,
        danger && styles.ctrlIconDanger,
      ]}>
        <Text style={[styles.ctrlIcon, danger && { color: COLORS.white }]}>{icon}</Text>
        {badge !== undefined && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ───────── 채팅 바텀시트 ───────── */
function ChatBottomSheet({
  visible, onClose, messages, input, onInputChange, onSend,
}: {
  visible: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
}) {
  const listRef = useRef<FlatList>(null);
  const { c, isDark } = useTheme();
  useEffect(() => {
    if (visible && messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [visible, messages]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.chatOverlay}>
        <TouchableOpacity style={styles.chatBackdrop} onPress={onClose} activeOpacity={1} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.chatContainer, { backgroundColor: c.surface }]}
        >
          <View style={[styles.chatHeader, { borderBottomColor: c.divider }]}>
            <View style={[styles.chatHandle, { backgroundColor: c.border }]} />
            <View style={styles.chatHeaderRow}>
              <Text style={[styles.chatTitle, { color: c.text }]}>채팅 ({messages.length})</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={{ fontSize: 22, color: c.textSubtle }}>×</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={() => (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ fontSize: 40, marginBottom: 8 }}>💬</Text>
                <Text style={{ color: c.textSubtle }}>아직 메시지가 없습니다</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <View style={[styles.msgRow, item.isLocal && styles.msgRowMine]}>
                {!item.isLocal && <Text style={[styles.msgName, { color: c.textMuted }]}>{item.name}</Text>}
                <View style={[
                  styles.msgBubble,
                  item.isLocal ? styles.msgBubbleMine : { backgroundColor: c.surfaceAlt, borderBottomLeftRadius: 4 },
                ]}>
                  <Text style={[
                    styles.msgText,
                    item.isLocal ? { color: '#ffffff' } : { color: c.text },
                  ]}>{item.message}</Text>
                </View>
                <Text style={[styles.msgTime, { color: c.textSubtle }]}>
                  {new Date(item.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            )}
          />

          <View style={[styles.chatInputRow, { borderTopColor: c.divider }]}>
            <TextInput
              value={input}
              onChangeText={onInputChange}
              placeholder="메시지 입력..."
              placeholderTextColor={c.placeholder}
              style={[styles.chatInput, {
                backgroundColor: c.surfaceAlt,
                color: c.text,
                borderWidth: isDark ? 1 : 0,
                borderColor: c.border,
              }]}
              multiline
              maxLength={500}
              onSubmitEditing={onSend}
            />
            <TouchableOpacity
              onPress={onSend}
              disabled={!input.trim()}
              style={[styles.chatSendBtn, !input.trim() && styles.chatSendBtnDisabled]}
            >
              <Text style={styles.chatSendText}>▸</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ───────── Styles ───────── */
const TOP_BAR_HEIGHT = Platform.OS === 'ios' ? 88 : 60;
const BOTTOM_BAR_HEIGHT = Platform.OS === 'ios' ? 100 : 88;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  /* 상단 바 */
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingTop: Platform.OS === 'ios' ? 44 : (RNStatusBar.currentHeight || 24),
    height: TOP_BAR_HEIGHT, backgroundColor: 'rgba(0,0,0,0.6)',
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
  },
  topBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  leaveIcon: { color: COLORS.white, fontSize: 18, fontWeight: '600' },
  topIcon: { fontSize: 18 },
  topCenter: { flex: 1, alignItems: 'center' },
  topTitle: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  topMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#dc2626' },
  topMeta: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  topSep: { color: 'rgba(255,255,255,0.5)' },

  /* 비디오 영역 */
  videoArea: { flex: 1, paddingTop: TOP_BAR_HEIGHT, paddingBottom: BOTTOM_BAR_HEIGHT },
  fullTile: { flex: 1, backgroundColor: '#1a1a1a', margin: 12, borderRadius: 20, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  gridTile: { backgroundColor: '#1a1a1a', borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },

  videoOff: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', alignItems: 'center', backgroundColor: '#2a2a2a' },
  bigAvatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.primary[500], alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  bigAvatarText: { fontSize: 40, fontWeight: '700', color: COLORS.white },
  gridAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary[500], alignItems: 'center', justifyContent: 'center' },
  gridAvatarText: { fontSize: 22, fontWeight: '700', color: COLORS.white },
  videoOffName: { color: COLORS.white, fontSize: 16, fontWeight: '600' },
  videoOffSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 },

  cameraPlaceholder: { flex: 1, alignSelf: 'stretch', backgroundColor: '#1a3a1a', alignItems: 'center', justifyContent: 'center' },
  cameraIcon: { fontSize: 50, marginBottom: 8 },
  cameraText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  cameraSub: { color: COLORS.primary[300], fontSize: 11, marginTop: 8 },
  cameraIconSmall: { fontSize: 30 },
  cameraSubSmall: { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 4 },

  nameTag: {
    position: 'absolute', bottom: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20,
  },
  nameTagText: { color: COLORS.white, fontSize: 12, fontWeight: '600' },
  nameTagMute: { fontSize: 12 },

  gridNameTag: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8,
  },
  gridNameText: { color: COLORS.white, fontSize: 11, fontWeight: '600', flex: 1 },
  gridIcons: { flexDirection: 'row', gap: 3 },
  hostIcon: { fontSize: 10 },
  muteIcon: { fontSize: 10 },

  connectingOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  connectingIcon: { fontSize: 64, marginBottom: 16 },
  connectingText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },

  devNotice: {
    position: 'absolute', top: TOP_BAR_HEIGHT + 16, left: 16, right: 16,
    backgroundColor: 'rgba(34, 197, 94, 0.12)', borderColor: COLORS.primary[500], borderWidth: 1,
    borderRadius: 10, padding: 10,
  },
  devNoticeLive: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)', borderColor: COLORS.primary[400],
  },
  devNoticeText: { color: COLORS.primary[300], fontSize: 11, lineHeight: 16, textAlign: 'center' },
  devNoticeTextLive: { color: COLORS.primary[200], fontWeight: '600' },

  /* 하단 컨트롤 바 */
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingVertical: 14, paddingBottom: Platform.OS === 'ios' ? 32 : 14,
    backgroundColor: 'rgba(0,0,0,0.85)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  ctrlBtn: { alignItems: 'center', minWidth: 60 },
  ctrlIconWrap: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  ctrlIconActive: { backgroundColor: '#dc2626' },
  ctrlIconDanger: { backgroundColor: '#dc2626' },
  ctrlIcon: { fontSize: 20 },
  ctrlLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginTop: 4 },
  badge: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8,
    backgroundColor: COLORS.primary[500], alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: COLORS.white, fontSize: 9, fontWeight: '700' },

  /* 채팅 바텀시트 */
  chatOverlay: { flex: 1, justifyContent: 'flex-end' },
  chatBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  chatContainer: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: height * 0.7 },
  chatHeader: { paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100] },
  chatHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.gray[200], alignSelf: 'center', marginBottom: 12 },
  chatHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  chatTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray[800] },

  msgRow: { alignSelf: 'flex-start', maxWidth: '80%' },
  msgRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgName: { fontSize: 11, color: COLORS.gray[500], marginBottom: 3, marginLeft: 4 },
  msgBubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, maxWidth: '100%' },
  msgBubbleMine: { backgroundColor: COLORS.primary[500], borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: COLORS.gray[100], borderBottomLeftRadius: 4 },
  msgText: { fontSize: 14, color: COLORS.gray[800], lineHeight: 20 },
  msgTime: { fontSize: 10, color: COLORS.gray[400], marginTop: 2, marginHorizontal: 4 },

  chatInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, paddingBottom: Platform.OS === 'ios' ? 30 : 12, borderTopWidth: 1, borderTopColor: COLORS.gray[100] },
  chatInput: {
    flex: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: COLORS.gray[100], maxHeight: 100, fontSize: 14, color: COLORS.gray[800],
  },
  chatSendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary[500], alignItems: 'center', justifyContent: 'center' },
  chatSendBtnDisabled: { backgroundColor: COLORS.gray[300] },
  chatSendText: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
});
