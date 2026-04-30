/**
 * 작업지시서 상세 화면 (Phase 1 Week 5 — P1)
 *
 * - GET /task-orders/:id 로 상세 로드
 * - 체크리스트 토글 (PATCH /:id/checklist/:checkId)
 * - 댓글 작성 (POST /:id/comments)
 * - 디자인 파일 업로드 — 카메라/사진/파일 (POST /:id/design-files multipart)
 * - 상태 전환 버튼 (관계자만)
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { COLORS, SPACING, RADIUS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import { useAuthStore } from '../../src/store/auth';
import api from '../../src/services/api';

interface UserLite { id: string; name: string; position?: string | null }

interface TaskItem {
  id: string;
  itemName: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
}

interface ChecklistItem {
  id: string;
  taskId: string;
  content: string;
  isCompleted: boolean;
  sortOrder: number;
}

interface TaskComment {
  id: string;
  content: string;
  createdAt: string;
  user: UserLite;
}

interface DesignFile {
  id: string;
  fileName: string;
  fileSize: number | string;
  mimeType: string;
  fileType: string;
  filePath: string;
  version: number;
  isLatest: boolean;
  uploader?: UserLite;
  createdAt: string;
}

interface TaskOrder {
  id: string;
  taskNumber: string;
  title: string;
  description?: string | null;
  status: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: string | null;
  creatorId: string;
  creator: UserLite;
  client?: { id: string; companyName: string } | null;
  assignees: { id: string; user: UserLite }[];
  items: TaskItem[];
  checklist: ChecklistItem[];
  comments: TaskComment[];
  designFiles: DesignFile[];
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft:            { label: '임시',    color: '#94a3b8' },
  instructed:       { label: '지시',    color: '#3b82f6' },
  in_progress:      { label: '진행중',  color: '#06b6d4' },
  partial_complete: { label: '부분완료', color: '#f59e0b' },
  work_complete:    { label: '작업완료', color: '#10b981' },
  billing_complete: { label: '청구완료', color: '#14b8a6' },
  final_complete:   { label: '최종완료', color: '#16a34a' },
  discarded:        { label: '폐기',    color: '#ef4444' },
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['instructed', 'discarded'],
  instructed: ['in_progress', 'discarded'],
  in_progress: ['partial_complete', 'work_complete'],
  partial_complete: ['work_complete'],
  work_complete: ['billing_complete', 'final_complete'],
  billing_complete: ['final_complete'],
};

const PRIO_COLOR: Record<string, string> = {
  low: '#94a3b8', normal: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
};
const PRIO_LABEL: Record<string, string> = {
  low: '낮음', normal: '보통', high: '높음', urgent: '긴급',
};

export default function TaskOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const insets = useSafeAreaInsets();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [task, setTask] = useState<TaskOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fetchTask = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/task-orders/${id}`);
      setTask(res.data?.data ?? null);
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error?.message || '작업지시서를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  const isAssignee = !!task?.assignees.some((a) => a.user.id === currentUserId);
  const isCreator = task?.creatorId === currentUserId;
  const canParticipate = isAssignee || isCreator;

  const toggleCheck = async (checkId: string) => {
    if (!task) return;
    try {
      const updated = await api.patch(`/task-orders/${task.id}/checklist/${checkId}`);
      // optimistic 갱신
      setTask((prev) => prev ? {
        ...prev,
        checklist: prev.checklist.map((c) =>
          c.id === checkId ? { ...c, isCompleted: updated.data.data.isCompleted } : c,
        ),
      } : prev);
    } catch (err: any) {
      Alert.alert('실패', err.response?.data?.error?.message || '갱신 실패');
    }
  };

  const submitComment = async () => {
    if (!task || !commentText.trim()) return;
    setPosting(true);
    try {
      const res = await api.post(`/task-orders/${task.id}/comments`, {
        content: commentText.trim(),
      });
      setTask((prev) => prev ? { ...prev, comments: [...prev.comments, res.data.data] } : prev);
      setCommentText('');
    } catch (err: any) {
      Alert.alert('실패', err.response?.data?.error?.message || '댓글 등록 실패');
    } finally {
      setPosting(false);
    }
  };

  const uploadDesignFile = async (uri: string, fileName: string, mimeType: string) => {
    if (!task) return;
    setUploading(true);
    try {
      const form = new FormData();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.append('file', { uri, name: fileName, type: mimeType } as any);
      await api.post(`/task-orders/${task.id}/design-files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await fetchTask();
      Alert.alert('완료', '파일이 업로드되었습니다');
    } catch (err: any) {
      Alert.alert('실패', err.response?.data?.error?.message || '업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('권한 필요', '카메라 접근 권한이 필요합니다');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (r.canceled) return;
    const a = r.assets?.[0];
    if (!a) return;
    await uploadDesignFile(
      a.uri,
      a.fileName || `현장사진-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jpg`,
      a.mimeType || 'image/jpeg',
    );
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (r.canceled) return;
    const a = r.assets?.[0];
    if (!a) return;
    const ext = (a.fileName || a.uri).split('.').pop()?.toLowerCase() || 'jpg';
    const mime = a.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
    await uploadDesignFile(a.uri, a.fileName || `image.${ext}`, mime);
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets?.[0];
    if (!a) return;
    await uploadDesignFile(a.uri, a.name, a.mimeType || 'application/octet-stream');
  };

  const showAttachMenu = () => {
    Alert.alert('파일 첨부', '어떤 방법으로 첨부할까요?', [
      { text: '📷 현장 사진 촬영', onPress: takePhoto },
      { text: '🖼 사진 라이브러리', onPress: pickPhoto },
      { text: '📎 파일 선택', onPress: pickFile },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const changeStatus = async (next: string) => {
    if (!task) return;
    Alert.alert('상태 변경', `'${STATUS_LABEL[next]?.label ?? next}' 로 변경할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '변경',
        onPress: async () => {
          try {
            await api.post(`/task-orders/${task.id}/status`, { status: next });
            await fetchTask();
          } catch (err: any) {
            Alert.alert('실패', err.response?.data?.error?.message || '상태 변경 실패');
          }
        },
      },
    ]);
  };

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
  const fmtSize = (n: number | string) => {
    const num = typeof n === 'string' ? Number(n) : n;
    if (num < 1024) return `${num}B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)}KB`;
    return `${(num / 1024 / 1024).toFixed(1)}MB`;
  };

  const checklistTotal = task?.checklist.length ?? 0;
  const checklistDone = task?.checklist.filter((x) => x.isCompleted).length ?? 0;
  const progress = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;

  if (loading && !task) {
    return (
      <>
        <Stack.Screen options={{ title: '작업지시서' }} />
        <View style={styles.center}><ActivityIndicator color={COLORS.primary[500]} /></View>
      </>
    );
  }
  if (!task) {
    return (
      <>
        <Stack.Screen options={{ title: '작업지시서' }} />
        <View style={styles.center}><Text style={styles.empty}>작업지시서를 찾을 수 없습니다</Text></View>
      </>
    );
  }

  const status = STATUS_LABEL[task.status] ?? STATUS_LABEL.draft;
  const prio = PRIO_LABEL[task.priority];
  const transitions = STATUS_TRANSITIONS[task.status] ?? [];

  return (
    <>
      <Stack.Screen options={{ title: task.title, headerBackTitle: '뒤로' }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchTask(); setRefreshing(false); }} />}
        >
          {/* 헤더 */}
          <View style={styles.header}>
            <Text style={styles.taskNumber}>{task.taskNumber}</Text>
            <View style={[styles.pill, { backgroundColor: status.color + '22' }]}>
              <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>
          <Text style={styles.title}>{task.title}</Text>

          <View style={styles.metaRow}>
            <Text style={[styles.priorityPill, { backgroundColor: PRIO_COLOR[task.priority] + '22', color: PRIO_COLOR[task.priority] }]}>
              {prio}
            </Text>
            <Text style={styles.metaText}>마감 {task.dueDate ? fmt(task.dueDate) : '-'}</Text>
            <Text style={styles.metaText}>{task.creator.name}</Text>
            {task.client && <Text style={styles.metaText}>· {task.client.companyName}</Text>}
          </View>

          {task.description && (
            <View style={styles.card}>
              <Text style={styles.descText}>{task.description}</Text>
            </View>
          )}

          {/* 상태 전환 (관계자만) */}
          {canParticipate && transitions.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>상태 변경</Text>
              <View style={styles.statusRow}>
                {transitions.map((s) => {
                  const meta = STATUS_LABEL[s];
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => changeStatus(s)}
                      style={[styles.statusBtn, { borderColor: meta.color }]}
                    >
                      <Text style={[styles.statusBtnText, { color: meta.color }]}>{meta.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* 체크리스트 */}
          {task.checklist.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>체크리스트</Text>
                <Text style={styles.progressText}>{checklistDone}/{checklistTotal} ({progress}%)</Text>
              </View>
              <View style={styles.card}>
                {task.checklist.map((c0) => (
                  <TouchableOpacity
                    key={c0.id}
                    style={styles.checkRow}
                    onPress={() => canParticipate && toggleCheck(c0.id)}
                    activeOpacity={canParticipate ? 0.6 : 1}
                  >
                    <View style={[styles.checkBox, c0.isCompleted && styles.checkBoxOn]}>
                      {c0.isCompleted && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={[styles.checkText, c0.isCompleted && styles.checkTextDone]}>
                      {c0.content}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* 항목(items) */}
          {task.items.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>품목 ({task.items.length})</Text>
              <View style={styles.card}>
                {task.items.map((it, i) => (
                  <View key={it.id} style={[styles.itemRow, i < task.items.length - 1 && styles.itemDivider]}>
                    <Text style={styles.itemName}>{it.itemName}</Text>
                    {it.description && <Text style={styles.itemDesc}>{it.description}</Text>}
                    <Text style={styles.itemQty}>
                      {it.quantity}{it.unit ? ` ${it.unit}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* 디자인 파일 / 현장 사진 */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>파일 ({task.designFiles.length})</Text>
            {canParticipate && (
              <TouchableOpacity
                onPress={showAttachMenu}
                disabled={uploading}
                style={[styles.uploadBtn, uploading && { opacity: 0.5 }]}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={COLORS.primary[500]} />
                ) : (
                  <Text style={styles.uploadBtnText}>📎 첨부</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.card}>
            {task.designFiles.length === 0 ? (
              <Text style={styles.empty}>첨부된 파일이 없습니다</Text>
            ) : (
              task.designFiles.map((f) => (
                <View key={f.id} style={styles.fileRow}>
                  <Text style={styles.fileIcon}>
                    {f.mimeType.startsWith('image/') ? '🖼' : f.mimeType.startsWith('video/') ? '🎥' : '📄'}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fileName} numberOfLines={1}>{f.fileName}</Text>
                    <Text style={styles.fileMeta}>
                      v{f.version} · {fmtSize(f.fileSize)} · {f.uploader?.name ?? '-'} · {fmt(f.createdAt)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* 댓글 */}
          <Text style={styles.sectionTitle}>댓글 ({task.comments.length})</Text>
          <View style={styles.card}>
            {task.comments.length === 0 ? (
              <Text style={styles.empty}>아직 댓글이 없습니다</Text>
            ) : (
              task.comments.map((cm, i) => (
                <View key={cm.id} style={[styles.commentRow, i < task.comments.length - 1 && styles.itemDivider]}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentName}>{cm.user.name}</Text>
                    <Text style={styles.commentTime}>{fmt(cm.createdAt)}</Text>
                  </View>
                  <Text style={styles.commentText}>{cm.content}</Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>

        {/* 댓글 입력 바 */}
        {canParticipate && (
          <View style={[styles.commentBar, { paddingBottom: Math.max(insets.bottom, SPACING.sm) }]}>
            <TextInput
              style={styles.commentInput}
              value={commentText}
              onChangeText={setCommentText}
              placeholder="댓글 작성..."
              placeholderTextColor={c.placeholder}
              maxLength={1000}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!commentText.trim() || posting) && { opacity: 0.4 }]}
              disabled={!commentText.trim() || posting}
              onPress={submitComment}
            >
              {posting ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.sendBtnText}>전송</Text>}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
  empty: { color: c.textSubtle, textAlign: 'center', padding: SPACING.md },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  taskNumber: { fontSize: 11, color: c.textSubtle, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillText: { fontSize: 11, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 8 },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.lg },
  metaText: { fontSize: 12, color: c.textMuted },
  priorityPill: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' as any },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  progressText: { fontSize: 12, color: c.text, fontWeight: '600', marginTop: 18 },

  card: {
    backgroundColor: c.surface, borderRadius: 14,
    ...(isDark ? { borderWidth: 1, borderColor: c.border } : {}),
    overflow: 'hidden',
  },
  descText: { fontSize: 14, color: c.text, lineHeight: 22, padding: SPACING.md },

  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  statusBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1.5, borderRadius: 10,
    backgroundColor: c.surface,
  },
  statusBtnText: { fontSize: 13, fontWeight: '700' },

  checkRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  checkBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: COLORS.primary[500], borderColor: COLORS.primary[500] },
  checkMark: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  checkText: { flex: 1, fontSize: 14, color: c.text },
  checkTextDone: { color: c.textSubtle, textDecorationLine: 'line-through' },

  itemRow: { padding: SPACING.md, gap: 4 },
  itemDivider: { borderBottomWidth: 1, borderBottomColor: c.divider },
  itemName: { fontSize: 14, fontWeight: '600', color: c.text },
  itemDesc: { fontSize: 12, color: c.textMuted },
  itemQty: { fontSize: 12, color: c.textMuted, marginTop: 4 },

  uploadBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: COLORS.primary[isDark ? 700 : 50],
    marginTop: 18,
  },
  uploadBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.primary[isDark ? 200 : 700] },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  fileIcon: { fontSize: 22 },
  fileName: { fontSize: 13, fontWeight: '600', color: c.text },
  fileMeta: { fontSize: 11, color: c.textSubtle, marginTop: 2 },

  commentRow: { padding: SPACING.md },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  commentName: { fontSize: 13, fontWeight: '600', color: c.text },
  commentTime: { fontSize: 11, color: c.textSubtle },
  commentText: { fontSize: 14, color: c.text, lineHeight: 20 },

  commentBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: SPACING.sm, paddingTop: SPACING.sm,
    backgroundColor: c.surface,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  commentInput: {
    flex: 1, minHeight: 40, maxHeight: 100,
    backgroundColor: c.surfaceAlt, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: c.text,
  },
  sendBtn: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 20,
    backgroundColor: COLORS.primary[500],
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
});
