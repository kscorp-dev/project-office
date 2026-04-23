import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { COLORS } from '../../src/constants/theme';
import { api } from '../../src/services/api';

type Status = 'scheduled' | 'in_progress' | 'ended' | 'cancelled';

interface Meeting {
  id: string;
  title: string;
  description?: string;
  status: Status;
  roomCode: string;
  scheduledAt: string;
  startedAt?: string;
  endedAt?: string;
  maxParticipants: number;
  host: { id: string; name: string; position?: string };
  participants?: Array<{ userId: string; joinedAt?: string; leftAt?: string }>;
}

const STATUS_META: Record<Status, { label: string; color: string; bg: string }> = {
  scheduled:   { label: '예정',   color: '#2563eb', bg: '#dbeafe' },
  in_progress: { label: '진행중', color: '#dc2626', bg: '#fee2e2' },
  ended:       { label: '종료',   color: '#6b7280', bg: '#f3f4f6' },
  cancelled:   { label: '취소',   color: '#9ca3af', bg: '#f3f4f6' },
};

export default function MeetingListScreen() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [showCreate, setShowCreate] = useState(false);

  const fetchMeetings = useCallback(async () => {
    try {
      const { data } = await api.get('/meeting');
      setMeetings(data.data || []);
    } catch (err: any) {
      console.warn('Fetch meetings failed:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchMeetings(); }, [fetchMeetings]);

  const onRefresh = () => { setRefreshing(true); fetchMeetings(); };

  const filtered = filter === 'all' ? meetings : meetings.filter((m) => m.status === filter);
  const inProgressCount = meetings.filter((m) => m.status === 'in_progress').length;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '화상회의',
          headerStyle: { backgroundColor: COLORS.white },
          headerShadowVisible: false,
        }}
      />

      {/* 필터 칩 */}
      <View style={styles.filterRow}>
        {(['all', 'in_progress', 'scheduled', 'ended'] as const).map((f) => {
          const active = filter === f;
          const labelMap: Record<typeof f, string> = {
            all: '전체', in_progress: '진행중', scheduled: '예정', ended: '종료',
          } as any;
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {labelMap[f]}
                {f === 'in_progress' && inProgressCount > 0 && (
                  <Text style={{ color: active ? COLORS.white : '#dc2626' }}> · {inProgressCount}</Text>
                )}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 목록 */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary[500]} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📭</Text>
              <Text style={styles.emptyTitle}>회의가 없습니다</Text>
              <Text style={styles.emptySub}>
                {filter === 'all' ? '첫 회의를 만들어보세요' : '해당 상태의 회의가 없습니다'}
              </Text>
            </View>
          )}
          renderItem={({ item }) => <MeetingCard meeting={item} onPress={() => router.push(`/meeting/${item.id}` as any)} />}
        />
      )}

      {/* FAB — 회의 생성 */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowCreate(true)}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>

      {/* 생성 모달 */}
      <CreateMeetingModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(m) => {
          setShowCreate(false);
          fetchMeetings();
          router.push(`/meeting/${m.id}` as any);
        }}
      />
    </View>
  );
}

/* ───────── 회의 카드 ───────── */
function MeetingCard({ meeting, onPress }: { meeting: Meeting; onPress: () => void }) {
  const meta = STATUS_META[meeting.status];
  const when = new Date(meeting.scheduledAt);
  const dateStr = when.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  const timeStr = when.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const participants = meeting.participants?.filter((p) => !p.leftAt).length ?? 0;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          {meeting.status === 'in_progress' && <View style={styles.pulseDot} />}
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.roomCode}>#{meeting.roomCode}</Text>
      </View>

      <Text style={styles.cardTitle} numberOfLines={1}>{meeting.title}</Text>
      {meeting.description && (
        <Text style={styles.cardDesc} numberOfLines={2}>{meeting.description}</Text>
      )}

      <View style={styles.cardMeta}>
        <View style={styles.metaItem}>
          <Text style={styles.metaIcon}>📅</Text>
          <Text style={styles.metaText}>{dateStr} · {timeStr}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaIcon}>👤</Text>
          <Text style={styles.metaText}>{meeting.host.name}</Text>
        </View>
        {participants > 0 && meeting.status === 'in_progress' && (
          <View style={styles.metaItem}>
            <Text style={styles.metaIcon}>🟢</Text>
            <Text style={[styles.metaText, { color: '#16a34a' }]}>{participants}명 참여 중</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/* ───────── 회의 생성 모달 ───────── */
function CreateMeetingModal({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (m: Meeting) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('8');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('알림', '회의 제목을 입력하세요');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/meeting', {
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledAt: new Date().toISOString(),
        maxParticipants: parseInt(maxParticipants, 10) || 8,
        participantIds: [],
      });
      setTitle(''); setDescription(''); setMaxParticipants('8');
      onCreated(data.data);
    } catch (err: any) {
      Alert.alert('생성 실패', err?.response?.data?.error?.message || '서버 오류');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>새 회의</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ fontSize: 22, color: COLORS.gray[400] }}>×</Text></TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.inputLabel}>제목 *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="예: 주간 전체 회의"
              style={styles.input}
              maxLength={100}
            />

            <Text style={styles.inputLabel}>설명 (선택)</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="회의 내용 간단히"
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              multiline
              maxLength={500}
            />

            <Text style={styles.inputLabel}>최대 참가자 (2~16)</Text>
            <TextInput
              value={maxParticipants}
              onChangeText={(v) => setMaxParticipants(v.replace(/[^0-9]/g, '').slice(0, 2))}
              keyboardType="number-pad"
              style={styles.input}
            />

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting || !title.trim()}
              style={[styles.submitBtn, (submitting || !title.trim()) && styles.submitBtnDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.submitBtnText}>회의 만들기</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ───────── 스타일 ───────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  filterRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100],
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: COLORS.gray[100],
  },
  chipActive: { backgroundColor: COLORS.primary[500] },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.gray[600] },
  chipTextActive: { color: COLORS.white },

  listContent: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  emptyEmoji: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray[700] },
  emptySub: { fontSize: 13, color: COLORS.gray[400], marginTop: 4 },

  card: {
    backgroundColor: COLORS.white, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#dc2626' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  roomCode: { fontSize: 11, color: COLORS.gray[400], fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.gray[800], marginBottom: 4 },
  cardDesc: { fontSize: 13, color: COLORS.gray[500], marginBottom: 10, lineHeight: 18 },
  cardMeta: { gap: 6, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaIcon: { fontSize: 12 },
  metaText: { fontSize: 12, color: COLORS.gray[600] },

  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary[500],
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.primary[500], shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabText: { fontSize: 28, color: COLORS.white, fontWeight: '300', marginTop: -2 },

  /* 모달 */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 24 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.gray[100],
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.gray[800] },
  modalBody: { paddingHorizontal: 20, paddingTop: 16 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: COLORS.gray[700], marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1, borderColor: COLORS.gray[200], borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.gray[800],
    backgroundColor: COLORS.gray[50],
  },
  submitBtn: {
    marginTop: 20, backgroundColor: COLORS.primary[500],
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  submitBtnDisabled: { backgroundColor: COLORS.gray[300] },
  submitBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
