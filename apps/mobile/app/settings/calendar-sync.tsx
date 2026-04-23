/**
 * 모바일 캘린더 동기화 설정 화면 (v0.16.0 Phase 1)
 *
 * 기능:
 *   - 내 구독 목록
 *   - 새 구독 생성 (간단 폼)
 *   - URL 복사 / webcal:// 링크로 iOS 캘린더 앱 직접 열기
 *   - 구독 폐기
 *
 * iOS에서 webcal:// 링크를 열면 OS가 "캘린더 앱에서 구독" 프롬프트를 띄움
 * Android는 Google Calendar 웹으로 리다이렉트 후 수동 추가
 */
import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Modal,
  Alert, Switch, ActivityIndicator, Linking, Platform, Clipboard,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { COLORS } from '../../src/constants/theme';
import { api } from '../../src/services/api';

type Scope = 'personal' | 'personal_dept' | 'all';

interface Subscription {
  id: string;
  name: string;
  scope: Scope;
  includeVacation: boolean;
  includeMeeting: boolean;
  includeTasks: boolean;
  reminderMinutes: number[];
  isActive: boolean;
  accessCount: number;
  createdAt: string;
  feedUrl: { https: string; webcal: string };
}

const SCOPE_LABEL: Record<Scope, string> = {
  personal: '개인 일정만',
  personal_dept: '개인 + 소속 부서',
  all: '전사 일정 포함',
};

export default function CalendarSyncScreen() {
  const router = useRouter();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchList = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/calendar-sync/subscriptions');
      setSubs(data.data || []);
    } catch (e: unknown) {
      Alert.alert('불러오기 실패', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchList(); }, []);

  const openWebcal = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        // Android는 webcal:// 미지원 — 복사 안내
        Alert.alert(
          '외부 앱 열기 실패',
          'webcal 스킴을 지원하지 않습니다. URL을 복사해 Google Calendar에 붙여넣으세요.',
          [
            { text: '취소', style: 'cancel' },
            { text: 'URL 복사', onPress: () => copyUrl(url.replace(/^webcal:/, 'https:')) },
          ],
        );
        return;
      }
      await Linking.openURL(url);
    } catch (e: unknown) {
      Alert.alert('열기 실패', (e as Error).message);
    }
  };

  const copyUrl = (url: string) => {
    Clipboard.setString(url);
    Alert.alert('복사 완료', '주소를 복사했습니다. 외부 캘린더 앱에 붙여넣으세요.');
  };

  const deleteSubscription = (id: string) => {
    Alert.alert('구독 삭제', '이 구독을 영구 삭제합니다. 계속할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/calendar-sync/subscriptions/${id}`);
            setSubs(subs.filter((s) => s.id !== id));
          } catch (e: unknown) {
            Alert.alert('삭제 실패', (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '외부 캘린더 연동' }} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* 안내 */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>📱 OS 캘린더로 일정 가져가기</Text>
          <Text style={styles.infoText}>
            여기서 만든 URL을 iPhone 캘린더나 Google Calendar에 추가하면,
            Project Office 일정이 OS 알림과 함께 표시됩니다.
          </Text>
          <Text style={styles.infoTextSmall}>
            iOS: webcal:// 버튼 한 번이면 자동 추가{'\n'}
            Android: URL 복사 → Google Calendar 웹에서 "URL로 추가"
          </Text>
        </View>

        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={COLORS.primary[500]} />
          </View>
        )}

        {!loading && subs.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📅</Text>
            <Text style={styles.emptyText}>아직 등록된 구독이 없습니다.</Text>
          </View>
        )}

        {subs.map((sub) => (
          <View
            key={sub.id}
            style={[styles.card, !sub.isActive && styles.cardInactive]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{sub.name}</Text>
              <Text
                style={[
                  styles.cardBadge,
                  sub.isActive ? styles.badgeActive : styles.badgeInactive,
                ]}
              >
                {sub.isActive ? '활성' : '비활성'}
              </Text>
            </View>

            <Text style={styles.cardMeta}>
              {SCOPE_LABEL[sub.scope]} · 알림 {sub.reminderMinutes.join(', ')}분 전
            </Text>
            <Text style={styles.cardMetaSmall}>
              {[
                sub.includeVacation && '휴가',
                sub.includeMeeting && '회의',
                sub.includeTasks && '작업',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>

            <View style={styles.cardActions}>
              <TouchableOpacity
                onPress={() => openWebcal(sub.feedUrl.webcal)}
                style={[styles.btn, styles.btnPrimary]}
              >
                <Text style={styles.btnTextPrimary}>
                  {Platform.OS === 'ios' ? '📲 캘린더에 추가' : '🔗 열기'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => copyUrl(sub.feedUrl.https)}
                style={[styles.btn, styles.btnSecondary]}
              >
                <Text style={styles.btnTextSecondary}>URL 복사</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => deleteSubscription(sub.id)}
                style={[styles.btn, styles.btnDanger]}
              >
                <Text style={styles.btnTextDanger}>삭제</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowCreate(true)}
        >
          <Text style={styles.addBtnText}>+ 새 구독 추가</Text>
        </TouchableOpacity>
      </ScrollView>

      <CreateModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(sub) => {
          setSubs([sub, ...subs]);
          setShowCreate(false);
        }}
      />
    </View>
  );
}

/* ───────── Create Modal ───────── */

function CreateModal({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (sub: Subscription) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('personal_dept');
  const [vacation, setVacation] = useState(true);
  const [meeting, setMeeting] = useState(true);
  const [tasks, setTasks] = useState(false);
  const [reminders, setReminders] = useState<number[]>([10]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setScope('personal_dept');
    setVacation(true);
    setMeeting(true);
    setTasks(false);
    setReminders([10]);
  };

  const toggleReminder = (n: number) =>
    setReminders((prev) =>
      prev.includes(n)
        ? prev.filter((x) => x !== n)
        : [...prev, n].sort((a, b) => a - b),
    );

  const submit = async () => {
    if (!name.trim()) {
      Alert.alert('이름 입력', '구독 이름을 입력해주세요');
      return;
    }
    if (reminders.length === 0) {
      Alert.alert('알림 선택', '알림 시간을 최소 1개 선택해주세요');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/calendar-sync/subscriptions', {
        name: name.trim(),
        scope,
        includeVacation: vacation,
        includeMeeting: meeting,
        includeTasks: tasks,
        reminderMinutes: reminders,
      });
      onCreated(data.data);
      reset();
    } catch (e: unknown) {
      const axiosErr = e as {
        response?: { data?: { error?: { message?: string } } };
      };
      Alert.alert(
        '생성 실패',
        axiosErr.response?.data?.error?.message ||
          (e as Error).message ||
          '오류',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.modalClose}>취소</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>새 구독</Text>
          <TouchableOpacity onPress={submit} disabled={submitting}>
            <Text
              style={[
                styles.modalSubmit,
                submitting && { opacity: 0.5 },
              ]}
            >
              {submitting ? '저장중' : '저장'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Text style={styles.label}>이름</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="내 iPhone"
            style={styles.input}
            maxLength={100}
          />

          <Text style={styles.label}>포함 범위</Text>
          {(['personal', 'personal_dept', 'all'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={styles.radio}
              onPress={() => setScope(s)}
            >
              <View
                style={[
                  styles.radioDot,
                  scope === s && styles.radioDotActive,
                ]}
              />
              <Text style={styles.radioLabel}>{SCOPE_LABEL[s]}</Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.label}>포함 항목</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>내 휴가</Text>
            <Switch value={vacation} onValueChange={setVacation} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>내 회의</Text>
            <Switch value={meeting} onValueChange={setMeeting} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>작업 마감일</Text>
            <Switch value={tasks} onValueChange={setTasks} />
          </View>

          <Text style={styles.label}>알림 시간 (복수 선택)</Text>
          <View style={styles.reminderGrid}>
            {[5, 10, 15, 30, 60].map((n) => (
              <TouchableOpacity
                key={n}
                onPress={() => toggleReminder(n)}
                style={[
                  styles.reminderChip,
                  reminders.includes(n) && styles.reminderChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.reminderChipText,
                    reminders.includes(n) &&
                      styles.reminderChipTextActive,
                  ]}
                >
                  {n}분 전
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ───────── 스타일 ───────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: 16, paddingBottom: 40 },

  infoBox: {
    backgroundColor: COLORS.primary[50],
    borderColor: COLORS.primary[200],
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  infoTitle: { fontWeight: '700', color: COLORS.primary[800], fontSize: 14 },
  infoText: { color: COLORS.primary[900], fontSize: 13, marginTop: 4, lineHeight: 18 },
  infoTextSmall: { color: COLORS.primary[700], fontSize: 11, marginTop: 8, lineHeight: 16 },

  loading: { padding: 40, alignItems: 'center' },
  empty: { alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, opacity: 0.4 },
  emptyText: { color: COLORS.gray[400], marginTop: 8 },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.gray[200],
  },
  cardInactive: { opacity: 0.6 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: { fontSize: 15, fontWeight: '700', color: COLORS.gray[800] },
  cardBadge: {
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    fontWeight: '600',
  },
  badgeActive: { backgroundColor: COLORS.primary[100], color: COLORS.primary[700] },
  badgeInactive: { backgroundColor: COLORS.gray[200], color: COLORS.gray[500] },
  cardMeta: { fontSize: 12, color: COLORS.gray[600], marginTop: 4 },
  cardMetaSmall: { fontSize: 11, color: COLORS.gray[400], marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 10 },

  btn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: COLORS.primary[500] },
  btnSecondary: { backgroundColor: COLORS.gray[100], borderWidth: 1, borderColor: COLORS.gray[200] },
  btnDanger: { backgroundColor: COLORS.white, borderWidth: 1, borderColor: '#fecaca' },
  btnTextPrimary: { color: COLORS.white, fontSize: 12, fontWeight: '600' },
  btnTextSecondary: { color: COLORS.gray[700], fontSize: 12, fontWeight: '600' },
  btnTextDanger: { color: '#dc2626', fontSize: 12, fontWeight: '600' },

  addBtn: {
    backgroundColor: COLORS.primary[500],
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  addBtnText: { color: COLORS.white, fontWeight: '700' },

  modalContainer: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  modalTitle: { fontWeight: '700', fontSize: 16, color: COLORS.gray[800] },
  modalClose: { fontSize: 14, color: COLORS.gray[500] },
  modalSubmit: { fontSize: 14, color: COLORS.primary[600], fontWeight: '600' },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.gray[200],
  },
  radio: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  radioDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.gray[300],
    marginRight: 8,
  },
  radioDotActive: {
    borderColor: COLORS.primary[500],
    backgroundColor: COLORS.primary[500],
  },
  radioLabel: { fontSize: 14, color: COLORS.gray[800] },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  switchLabel: { fontSize: 14, color: COLORS.gray[800] },

  reminderGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  reminderChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.gray[300],
    backgroundColor: COLORS.white,
  },
  reminderChipActive: {
    backgroundColor: COLORS.primary[500],
    borderColor: COLORS.primary[500],
  },
  reminderChipText: { fontSize: 12, color: COLORS.gray[700] },
  reminderChipTextActive: { color: COLORS.white, fontWeight: '600' },
});
