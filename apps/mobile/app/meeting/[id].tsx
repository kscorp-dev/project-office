import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { COLORS } from '../../src/constants/theme';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/store/auth';

type Status = 'scheduled' | 'in_progress' | 'ended' | 'cancelled';

interface Participant {
  userId: string;
  role: string;
  joinedAt?: string;
  leftAt?: string;
  user: { id: string; name: string; position?: string; email: string };
}

interface MeetingDetail {
  id: string;
  title: string;
  description?: string;
  status: Status;
  roomCode: string;
  scheduledAt: string;
  startedAt?: string;
  endedAt?: string;
  maxParticipants: number;
  password?: string;
  host: { id: string; name: string; position?: string; email: string };
  hostId: string;
  participants: Participant[];
}

const STATUS_META: Record<Status, { label: string; color: string; bg: string }> = {
  scheduled:   { label: '예정',   color: '#2563eb', bg: '#dbeafe' },
  in_progress: { label: '진행중', color: '#dc2626', bg: '#fee2e2' },
  ended:       { label: '종료',   color: '#6b7280', bg: '#f3f4f6' },
  cancelled:   { label: '취소',   color: '#9ca3af', bg: '#f3f4f6' },
};

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const { data } = await api.get(`/meeting/${id}`);
      setMeeting(data.data);
    } catch (err: any) {
      Alert.alert('오류', err?.response?.data?.error?.message || '회의 정보를 불러올 수 없습니다');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  if (loading || !meeting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary[500]} />
      </View>
    );
  }

  const isHost = meeting.hostId === currentUser?.id;
  const meta = STATUS_META[meeting.status];
  const scheduledAt = new Date(meeting.scheduledAt);
  const startedAt = meeting.startedAt ? new Date(meeting.startedAt) : null;
  const endedAt = meeting.endedAt ? new Date(meeting.endedAt) : null;

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await api.post(`/meeting/${id}/start`);
      await fetchDetail();
      Alert.alert('시작됨', '회의가 시작되었습니다. 참여하시겠습니까?', [
        { text: '나중에', style: 'cancel' },
        { text: '참여', onPress: () => router.push(`/meeting/${id}/room` as any) },
      ]);
    } catch (err: any) {
      Alert.alert('오류', err?.response?.data?.error?.message || '시작할 수 없습니다');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnd = () => {
    Alert.alert('회의 종료', '정말로 회의를 종료하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '종료', style: 'destructive', onPress: async () => {
          setActionLoading(true);
          try {
            await api.post(`/meeting/${id}/end`);
            await fetchDetail();
          } catch (err: any) {
            Alert.alert('오류', err?.response?.data?.error?.message || '종료 실패');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const handleJoin = () => router.push(`/meeting/${id}/room` as any);

  const handleCancel = () => {
    Alert.alert('회의 취소', '회의를 취소하시겠습니까?', [
      { text: '아니오', style: 'cancel' },
      {
        text: '취소', style: 'destructive', onPress: async () => {
          try {
            await api.post(`/meeting/${id}/cancel`);
            router.back();
          } catch (err: any) {
            Alert.alert('오류', err?.response?.data?.error?.message || '취소 실패');
          }
        },
      },
    ]);
  };

  const activeParticipants = meeting.participants.filter((p) => !p.leftAt);
  const pastParticipants = meeting.participants.filter((p) => p.leftAt);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: meeting.title, headerTitleStyle: { fontSize: 16 } }} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 상태 뱃지 */}
        <View style={styles.heroSection}>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            {meeting.status === 'in_progress' && <View style={styles.pulseDot} />}
            <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <Text style={styles.title}>{meeting.title}</Text>
          {meeting.description && <Text style={styles.description}>{meeting.description}</Text>}
          <Text style={styles.roomCode}>회의실 코드: {meeting.roomCode}</Text>
        </View>

        {/* 정보 박스 */}
        <View style={styles.infoCard}>
          <InfoRow icon="👤" label="주최자" value={meeting.host.name} sub={meeting.host.position} />
          <View style={styles.separator} />
          <InfoRow
            icon="📅"
            label="예정 시간"
            value={scheduledAt.toLocaleString('ko-KR', {
              year: 'numeric', month: 'long', day: 'numeric',
              hour: '2-digit', minute: '2-digit', weekday: 'short',
            })}
          />
          {startedAt && (
            <>
              <View style={styles.separator} />
              <InfoRow
                icon="🟢"
                label="시작됨"
                value={startedAt.toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              />
            </>
          )}
          {endedAt && (
            <>
              <View style={styles.separator} />
              <InfoRow
                icon="🔴"
                label="종료됨"
                value={endedAt.toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              />
            </>
          )}
          <View style={styles.separator} />
          <InfoRow icon="👥" label="최대 인원" value={`${meeting.maxParticipants}명`} />
        </View>

        {/* 참가자 */}
        <Text style={styles.sectionTitle}>
          참가자 ({activeParticipants.length}{pastParticipants.length > 0 && ` / 이전 ${pastParticipants.length}`})
        </Text>
        <View style={styles.participantsCard}>
          {meeting.participants.length === 0 ? (
            <Text style={styles.emptyText}>아직 참여한 사람이 없습니다</Text>
          ) : (
            meeting.participants.map((p) => (
              <ParticipantRow key={p.userId} p={p} isHost={p.userId === meeting.hostId} />
            ))
          )}
        </View>
      </ScrollView>

      {/* CTA 하단 고정 바 */}
      <View style={styles.ctaBar}>
        {meeting.status === 'scheduled' && isHost && (
          <>
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel}>
              <Text style={styles.secondaryBtnText}>회의 취소</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleStart} disabled={actionLoading}>
              {actionLoading ? <ActivityIndicator color={COLORS.white} /> : (
                <Text style={styles.primaryBtnText}>▶  회의 시작</Text>
              )}
            </TouchableOpacity>
          </>
        )}
        {meeting.status === 'scheduled' && !isHost && (
          <View style={[styles.primaryBtn, styles.primaryBtnDisabled]}>
            <Text style={styles.primaryBtnText}>⏳  주최자 시작 대기중</Text>
          </View>
        )}
        {meeting.status === 'in_progress' && (
          <>
            {isHost && (
              <TouchableOpacity style={styles.dangerBtn} onPress={handleEnd} disabled={actionLoading}>
                <Text style={styles.dangerBtnText}>종료</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin}>
              <Text style={styles.primaryBtnText}>🎥  회의 참여하기</Text>
            </TouchableOpacity>
          </>
        )}
        {(meeting.status === 'ended' || meeting.status === 'cancelled') && (
          <View style={[styles.primaryBtn, styles.primaryBtnDisabled]}>
            <Text style={styles.primaryBtnText}>
              {meeting.status === 'ended' ? '✓  종료된 회의' : '회의가 취소되었습니다'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ───────── 서브 컴포넌트 ───────── */
function InfoRow({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
        {sub && <Text style={styles.infoSub}>{sub}</Text>}
      </View>
    </View>
  );
}

function ParticipantRow({ p, isHost }: { p: Participant; isHost: boolean }) {
  const initial = (p.user.name?.[0] || '?').toUpperCase();
  const isActive = !p.leftAt;
  return (
    <View style={styles.participantRow}>
      <View style={[styles.avatar, { backgroundColor: isHost ? COLORS.primary[500] : COLORS.gray[300] }]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.participantName}>{p.user.name}</Text>
          {isHost && <Text style={styles.hostTag}>호스트</Text>}
        </View>
        {p.user.position && <Text style={styles.participantSub}>{p.user.position}</Text>}
      </View>
      {isActive && p.joinedAt && (
        <View style={styles.liveTag}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>참여중</Text>
        </View>
      )}
      {p.leftAt && (
        <Text style={styles.leftText}>나감</Text>
      )}
    </View>
  );
}

/* ───────── 스타일 ───────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  scrollContent: { padding: 16, paddingBottom: 120 },

  heroSection: { marginBottom: 20 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 10 },
  pulseDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#dc2626' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.gray[800], marginBottom: 6 },
  description: { fontSize: 14, color: COLORS.gray[600], lineHeight: 20, marginBottom: 8 },
  roomCode: { fontSize: 12, color: COLORS.gray[400], fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  infoCard: {
    backgroundColor: COLORS.white, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6, elevation: 1,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  infoIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  infoLabel: { fontSize: 11, color: COLORS.gray[400], marginBottom: 2, fontWeight: '600' },
  infoValue: { fontSize: 14, color: COLORS.gray[800] },
  infoSub: { fontSize: 12, color: COLORS.gray[500], marginTop: 2 },
  separator: { height: 1, backgroundColor: COLORS.gray[100] },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.gray[700], marginTop: 24, marginBottom: 10, paddingLeft: 4 },
  participantsCard: {
    backgroundColor: COLORS.white, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6, elevation: 1,
  },
  emptyText: { textAlign: 'center', color: COLORS.gray[400], padding: 24, fontSize: 13 },
  participantRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100],
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: COLORS.white },
  participantName: { fontSize: 14, fontWeight: '600', color: COLORS.gray[800] },
  hostTag: { fontSize: 10, fontWeight: '700', color: COLORS.primary[600], backgroundColor: COLORS.primary[50], paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  participantSub: { fontSize: 11, color: COLORS.gray[500], marginTop: 2 },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#16a34a' },
  liveText: { fontSize: 11, fontWeight: '600', color: '#16a34a' },
  leftText: { fontSize: 11, color: COLORS.gray[400] },

  /* CTA */
  ctaBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.gray[100],
  },
  primaryBtn: { flex: 1, backgroundColor: COLORS.primary[500], borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { backgroundColor: COLORS.gray[300] },
  primaryBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  secondaryBtn: { flex: 1, backgroundColor: COLORS.gray[100], borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.gray[700], fontSize: 15, fontWeight: '600' },
  dangerBtn: { backgroundColor: '#fee2e2', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  dangerBtnText: { color: '#dc2626', fontSize: 15, fontWeight: '700' },
});
