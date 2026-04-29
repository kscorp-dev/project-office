/**
 * 결재 문서 상세 화면 (Phase 1 핵심)
 *
 * - GET /approvals/documents/:id 로 문서 로드
 * - 결재선 다이어그램 (각 step 상태 ✓ / ● / 대기)
 * - 첨부파일 목록 (탭 시 다운로드/열기)
 * - 하단 Sticky Action Bar:
 *   · 내가 현재 결재 차례면 "승인" / "반려" (생체 인증 후 서버 호출)
 *   · 기안자이고 pending 상태면 "회수"
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import api from '../../src/services/api';
import { useAuthStore } from '../../src/store/auth';
import { useBiometric } from '../../src/hooks/useBiometric';

interface Drafter {
  id: string; name: string; employeeId: string; position?: string | null;
  department?: { name: string } | null;
}

interface Line {
  id: string;
  step: number;
  status: 'pending' | 'approved' | 'rejected';
  comment?: string | null;
  actedAt?: string | null;
  approver: Drafter;
}

interface Attachment {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

interface ApprovalDoc {
  id: string;
  docNumber: string;
  title: string;
  content: string;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  status: 'draft' | 'pending' | 'approved' | 'rejected';
  currentStep: number;
  submittedAt?: string | null;
  createdAt: string;
  completedAt?: string | null;
  drafter: Drafter;
  drafterId: string;
  template?: { id: string; name: string; code: string; category?: string | null } | null;
  lines: Line[];
  references: { id: string; user: { id: string; name: string; employeeId: string } }[];
  attachments: Attachment[];
}

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  draft:    { label: '임시저장', bg: '#f1f5f9', text: '#475569' },
  pending:  { label: '결재 대기', bg: '#fef9c3', text: '#a16207' },
  approved: { label: '승인 완료', bg: '#dcfce7', text: '#15803d' },
  rejected: { label: '반려됨',    bg: '#fef2f2', text: '#dc2626' },
};

export default function ApprovalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { authenticate } = useBiometric();
  const insets = useSafeAreaInsets();
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);

  const [doc, setDoc] = useState<ApprovalDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const fetchDoc = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/approvals/documents/${id}`);
      setDoc(res.data?.data ?? null);
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error?.message || '문서를 불러올 수 없습니다');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  const myCurrentLine = doc?.lines.find((l) => l.approver.id === currentUserId);

  const isMyTurn =
    !!doc &&
    doc.status === 'pending' &&
    !!myCurrentLine &&
    myCurrentLine.step === doc.currentStep &&
    myCurrentLine.status === 'pending';

  const isDrafter = !!doc && doc.drafterId === currentUserId;
  const canWithdraw =
    isDrafter && doc?.status === 'pending' &&
    doc.lines.every((l) => l.status === 'pending'); // 아무도 승인 전이면 회수 가능

  const handleApprove = async () => {
    if (!doc) return;
    Alert.alert(
      '이 문서를 승인합니다',
      `${doc.title}\n(${doc.docNumber})`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '승인',
          style: 'default',
          onPress: async () => {
            const biom = await authenticate('결재 승인을 위해 인증해주세요');
            if (!biom.success && !biom.skipped) {
              Alert.alert('인증 실패', biom.error ?? '다시 시도해주세요');
              return;
            }
            setSubmitting(true);
            try {
              await api.post(`/approvals/documents/${doc.id}/approve`, {});
              Alert.alert('완료', '승인되었습니다', [
                { text: '확인', onPress: () => router.back() },
              ]);
            } catch (err: any) {
              Alert.alert('실패', err.response?.data?.error?.message || '승인 실패');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const handleReject = async () => {
    if (!doc) return;
    if (!rejectReason.trim()) {
      Alert.alert('사유 입력', '반려 사유를 입력해주세요');
      return;
    }
    const biom = await authenticate('결재 반려를 위해 인증해주세요');
    if (!biom.success && !biom.skipped) {
      Alert.alert('인증 실패', biom.error ?? '다시 시도해주세요');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/approvals/documents/${doc.id}/reject`, { comment: rejectReason.trim() });
      setRejectOpen(false);
      setRejectReason('');
      Alert.alert('완료', '반려되었습니다', [
        { text: '확인', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('실패', err.response?.data?.error?.message || '반려 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!doc) return;
    Alert.alert(
      '이 문서를 회수합니다',
      '회수된 문서는 임시저장 상태로 돌아갑니다',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '회수',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await api.post(`/approvals/documents/${doc.id}/withdraw`);
              Alert.alert('완료', '회수되었습니다', [
                { text: '확인', onPress: () => router.back() },
              ]);
            } catch (err: any) {
              Alert.alert('실패', err.response?.data?.error?.message || '회수 실패');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const fmtDateTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  const fmtSize = (n: number) => n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`;

  if (loading && !doc) {
    return (
      <>
        <Stack.Screen options={{ title: '결재 상세' }} />
        <View style={styles.center}><ActivityIndicator color={COLORS.primary[500]} /></View>
      </>
    );
  }
  if (!doc) {
    return (
      <>
        <Stack.Screen options={{ title: '결재 상세' }} />
        <View style={styles.center}><Text style={styles.empty}>문서를 찾을 수 없습니다</Text></View>
      </>
    );
  }

  const statusMeta = STATUS_META[doc.status] ?? STATUS_META.draft;

  return (
    <>
      <Stack.Screen options={{ title: doc.title, headerBackTitle: '뒤로' }} />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchDoc(); setRefreshing(false); }} />}
        >
          {/* 헤더 */}
          <View style={styles.headerBlock}>
            <Text style={styles.docNumber}>{doc.docNumber}</Text>
            <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
              <Text style={[styles.statusText, { color: statusMeta.text }]}>{statusMeta.label}</Text>
            </View>
          </View>

          <Text style={styles.title}>{doc.title}</Text>
          <Text style={styles.meta}>
            {doc.drafter.name}{doc.drafter.department?.name ? ` · ${doc.drafter.department.name}` : ''}
            {doc.drafter.position ? ` · ${doc.drafter.position}` : ''}
          </Text>
          <Text style={styles.meta}>
            상신 {fmtDateTime(doc.submittedAt ?? doc.createdAt)}
            {doc.template?.name && ` · ${doc.template.name}`}
          </Text>

          {/* 결재선 다이어그램 */}
          <Text style={styles.sectionTitle}>결재선</Text>
          <View style={styles.lineBlock}>
            {doc.lines.map((l, idx) => {
              const icon = l.status === 'approved' ? '✓'
                : l.status === 'rejected' ? '✕'
                : l.step === doc.currentStep ? '●'
                : '○';
              const iconColor = l.status === 'approved' ? '#16a34a'
                : l.status === 'rejected' ? '#dc2626'
                : l.step === doc.currentStep ? COLORS.primary[500]
                : COLORS.gray[400];
              const isMe = l.approver.id === currentUserId;
              return (
                <View key={l.id}>
                  <View style={styles.lineRow}>
                    <View style={[styles.lineBadge, { borderColor: iconColor }]}>
                      <Text style={[styles.lineBadgeText, { color: iconColor }]}>{icon}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineName}>
                        {l.approver.name}
                        {isMe && <Text style={styles.lineMe}> (나)</Text>}
                      </Text>
                      <Text style={styles.lineDept}>
                        {l.approver.department?.name ?? ''}
                        {l.approver.position ? ` · ${l.approver.position}` : ''}
                      </Text>
                      {l.actedAt && (
                        <Text style={styles.lineActed}>{fmtDateTime(l.actedAt)}</Text>
                      )}
                      {l.comment && (
                        <Text style={styles.lineComment}>"{l.comment}"</Text>
                      )}
                    </View>
                  </View>
                  {idx < doc.lines.length - 1 && <View style={styles.lineDivider} />}
                </View>
              );
            })}
          </View>

          {/* 본문 */}
          <Text style={styles.sectionTitle}>본문</Text>
          <View style={styles.card}>
            <Text style={styles.content}>{doc.content || '(내용 없음)'}</Text>
          </View>

          {/* 첨부파일 */}
          {doc.attachments.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>첨부 ({doc.attachments.length})</Text>
              <View style={styles.card}>
                {doc.attachments.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={styles.attachRow}
                    onPress={() => Alert.alert('다운로드', 'PC 또는 웹에서 다운로드해주세요')}
                  >
                    <Text style={styles.attachIcon}>📎</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.attachName}>{a.fileName}</Text>
                      <Text style={styles.attachSize}>{fmtSize(a.fileSize)} · {a.mimeType}</Text>
                    </View>
                    <Text style={styles.attachChev}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* 참조자 */}
          {doc.references.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>참조</Text>
              <View style={styles.card}>
                {doc.references.map((r) => (
                  <View key={r.id} style={styles.refRow}>
                    <Text style={styles.refName}>{r.user.name}</Text>
                    <Text style={styles.refId}>{r.user.employeeId}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>

        {/* 하단 Sticky Action Bar — safe area insets.bottom 추가 */}
        {(isMyTurn || canWithdraw) && (
          <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            {isMyTurn && (
              <>
                <TouchableOpacity
                  style={[styles.btn, styles.btnReject]}
                  onPress={() => setRejectOpen(true)}
                  disabled={submitting}
                >
                  <Text style={styles.btnRejectText}>✕ 반려</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnApprove]}
                  onPress={handleApprove}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnApproveText}>✓ 승인</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
            {!isMyTurn && canWithdraw && (
              <TouchableOpacity
                style={[styles.btn, styles.btnWithdraw]}
                onPress={handleWithdraw}
                disabled={submitting}
              >
                <Text style={styles.btnWithdrawText}>↩ 회수</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 반려 사유 모달 */}
        <Modal visible={rejectOpen} transparent animationType="slide" onRequestClose={() => setRejectOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalBg}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>반려 사유</Text>
              <TextInput
                style={styles.modalInput}
                value={rejectReason}
                onChangeText={setRejectReason}
                placeholder="반려 사유를 입력해주세요 (필수)"
                placeholderTextColor={c.placeholder}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={500}
                autoFocus
              />
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnCancel]}
                  onPress={() => { setRejectOpen(false); setRejectReason(''); }}
                  disabled={submitting}
                >
                  <Text style={styles.btnCancelText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnReject]}
                  onPress={handleReject}
                  disabled={submitting || !rejectReason.trim()}
                >
                  {submitting ? (
                    <ActivityIndicator color="#dc2626" />
                  ) : (
                    <Text style={styles.btnRejectText}>반려 확정</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: c.textSubtle },

  headerBlock: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  docNumber: { fontSize: 11, color: c.textSubtle, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: '700' },

  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 6 },
  meta: { fontSize: 12, color: c.textMuted, marginBottom: 2 },

  sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' },
  card: { backgroundColor: c.surface, borderRadius: 14, padding: 14, overflow: 'hidden', ...(isDark ? { borderWidth: 1, borderColor: c.border } : {}) },
  content: { fontSize: 14, lineHeight: 22, color: c.text },

  lineBlock: { backgroundColor: c.surface, borderRadius: 14, padding: 14, ...(isDark ? { borderWidth: 1, borderColor: c.border } : {}) },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  lineBadge: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  lineBadgeText: { fontSize: 14, fontWeight: '700' },
  lineName: { fontSize: 14, fontWeight: '600', color: c.text },
  lineMe: { color: COLORS.primary[isDark ? 400 : 500], fontWeight: '700' },
  lineDept: { fontSize: 11, color: c.textMuted, marginTop: 1 },
  lineActed: { fontSize: 11, color: c.textSubtle, marginTop: 3 },
  lineComment: { fontSize: 12, color: c.textMuted, fontStyle: 'italic', marginTop: 4 },
  lineDivider: { height: 1, backgroundColor: c.divider, marginLeft: 44 },

  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider },
  attachIcon: { fontSize: 18 },
  attachName: { fontSize: 13, color: c.text, fontWeight: '500' },
  attachSize: { fontSize: 11, color: c.textSubtle, marginTop: 2 },
  attachChev: { fontSize: 18, color: c.textSubtle },

  refRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  refName: { fontSize: 13, color: c.text },
  refId: { fontSize: 11, color: c.textSubtle },

  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', gap: 10,
    paddingTop: 14, paddingHorizontal: 14,
    backgroundColor: c.surface,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  btn: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnApprove: { backgroundColor: COLORS.primary[500] },
  btnApproveText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
  btnReject: {
    backgroundColor: isDark ? '#3a0f10' : '#fef2f2',
    borderWidth: 1, borderColor: isDark ? '#7f1d1d' : '#fecaca',
  },
  btnRejectText: { color: isDark ? '#fca5a5' : '#dc2626', fontWeight: '700', fontSize: 15 },
  btnWithdraw: { backgroundColor: isDark ? '#3a2a08' : '#fef3c7' },
  btnWithdrawText: { color: isDark ? '#fcd34d' : '#a16207', fontWeight: '700', fontSize: 15 },
  btnCancel: { backgroundColor: c.surfaceAlt },
  btnCancelText: { color: c.textMuted, fontWeight: '600' },

  modalBg: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 24,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  modalInput: {
    backgroundColor: c.surfaceAlt, borderRadius: 10,
    padding: 12, fontSize: 14, color: c.text,
    minHeight: 100, marginBottom: 14,
    borderWidth: 1, borderColor: c.border,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
});
