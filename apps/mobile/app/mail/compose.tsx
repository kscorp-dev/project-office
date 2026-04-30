/**
 * 메일 작성 화면 — 신규 / 답장 / 전체답장 / 전달.
 *
 * 라우팅 파라미터 (선택):
 *   - mode: 'reply' | 'replyAll' | 'forward'  답장/전달 모드 (없으면 신규)
 *   - sourceUid: 원본 메일 UID
 *   - subject: 원본 제목 (Re: / Fwd: 자동 prefix)
 *   - fromEmail / fromName: 답장 받는 사람으로 사전 설정
 *   - toEmails / ccEmails: 원본 수신자 (replyAll 시 보존)
 *   - sentAt: 인용문 헤더용
 *   - bodyText: 인용 본문 (>>>으로 prefix)
 *
 * 백엔드 흐름:
 *   POST /api/mail/send  (multipart/form-data)
 *     - to / cc / bcc — 콤마/세미콜론 구분
 *     - subject, text, html, attachments[]
 *
 * 첨부 정책:
 *   - 사진 (image picker) + 일반 파일 (document picker)
 *   - 단일 파일 25MB 한도 (서버 검증)
 *   - 한 번에 최대 10개
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import api from '../../src/services/api';

interface Attachment {
  uri: string;
  name: string;
  size: number;
  mimeType?: string;
}

const MAX_ATTACH_COUNT = 10;
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

export default function MailComposeScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const params = useLocalSearchParams<{
    mode?: 'reply' | 'replyAll' | 'forward';
    sourceUid?: string;
    subject?: string;
    fromEmail?: string;
    fromName?: string;
    toEmails?: string;
    ccEmails?: string;
    sentAt?: string;
    bodyText?: string;
  }>();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);

  // 답장/전달 모드일 때 초기값 채우기
  useEffect(() => {
    const mode = params.mode;
    if (!mode) return;

    const subjectRaw = String(params.subject ?? '');
    if (mode === 'reply' || mode === 'replyAll') {
      setTo(String(params.fromEmail ?? ''));
      if (mode === 'replyAll') {
        const others = String(params.toEmails ?? '').split(',').filter(Boolean);
        const ccs = String(params.ccEmails ?? '').split(',').filter(Boolean);
        const allCc = [...others, ...ccs];
        if (allCc.length > 0) {
          setCc(allCc.join(', '));
          setShowCc(true);
        }
      }
      setSubject(subjectRaw.toLowerCase().startsWith('re:') ? subjectRaw : `Re: ${subjectRaw}`);
    } else if (mode === 'forward') {
      setSubject(subjectRaw.toLowerCase().startsWith('fwd:') ? subjectRaw : `Fwd: ${subjectRaw}`);
    }

    // 인용 본문
    const senderLabel = params.fromName
      ? `${params.fromName} <${params.fromEmail}>`
      : (params.fromEmail ?? '발신자');
    const dateLabel = params.sentAt ? new Date(String(params.sentAt)).toLocaleString('ko-KR') : '';
    const quoted = String(params.bodyText ?? '')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');

    setBody(`\n\n--- ${dateLabel} ${senderLabel} 님이 작성 ---\n${quoted}\n`);
  }, [params.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickImage = useCallback(async () => {
    if (attachments.length >= MAX_ATTACH_COUNT) {
      Alert.alert('알림', `첨부파일은 최대 ${MAX_ATTACH_COUNT}개까지 가능합니다`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || res.assets.length === 0) return;
    const a = res.assets[0];
    if (a.fileSize && a.fileSize > MAX_ATTACH_BYTES) {
      Alert.alert('알림', '단일 파일은 25MB 이하만 첨부 가능합니다');
      return;
    }
    setAttachments((prev) => [...prev, {
      uri: a.uri,
      name: a.fileName ?? 'photo.jpg',
      size: a.fileSize ?? 0,
      mimeType: a.mimeType ?? 'image/jpeg',
    }]);
  }, [attachments.length]);

  const pickFile = useCallback(async () => {
    if (attachments.length >= MAX_ATTACH_COUNT) {
      Alert.alert('알림', `첨부파일은 최대 ${MAX_ATTACH_COUNT}개까지 가능합니다`);
      return;
    }
    const res = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (res.canceled || res.assets.length === 0) return;
    const a = res.assets[0];
    if (a.size && a.size > MAX_ATTACH_BYTES) {
      Alert.alert('알림', '단일 파일은 25MB 이하만 첨부 가능합니다');
      return;
    }
    setAttachments((prev) => [...prev, {
      uri: a.uri,
      name: a.name,
      size: a.size ?? 0,
      mimeType: a.mimeType,
    }]);
  }, [attachments.length]);

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const send = async () => {
    if (!to.trim()) {
      Alert.alert('알림', '받는 사람을 입력하세요');
      return;
    }
    if (!subject.trim()) {
      Alert.alert('알림', '제목을 입력하세요');
      return;
    }
    if (!body.trim()) {
      Alert.alert('알림', '본문을 입력하세요');
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append('to', to.trim());
      if (cc.trim()) form.append('cc', cc.trim());
      form.append('subject', subject.trim());
      form.append('text', body);
      attachments.forEach((a) => {
        form.append('attachments', {
          uri: a.uri,
          name: a.name,
          type: a.mimeType ?? 'application/octet-stream',
        } as any);
      });
      await api.post('/mail/send', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      Alert.alert('전송 완료', '메일이 전송되었습니다', [
        { text: '확인', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('실패', err?.response?.data?.error?.message ?? '전송 실패');
    } finally {
      setSending(false);
    }
  };

  const headerTitle = params.mode === 'reply' || params.mode === 'replyAll'
    ? '답장'
    : params.mode === 'forward' ? '전달' : '새 메일';

  return (
    <>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerRight: () => (
            <TouchableOpacity onPress={send} disabled={sending} style={{ paddingHorizontal: 8 }}>
              {sending ? (
                <ActivityIndicator color={COLORS.primary[500]} />
              ) : (
                <Text style={{ color: COLORS.primary[500], fontWeight: '700', fontSize: 15 }}>
                  전송
                </Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.fieldRow}>
            <Text style={styles.label}>받는 사람</Text>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder="email@example.com"
              placeholderTextColor={c.placeholder}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
          </View>

          {showCc ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>참조</Text>
              <TextInput
                value={cc}
                onChangeText={setCc}
                placeholder="콤마로 여러 명"
                placeholderTextColor={c.placeholder}
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.input}
              />
            </View>
          ) : (
            <TouchableOpacity onPress={() => setShowCc(true)} style={styles.ccToggle}>
              <Text style={styles.ccToggleText}>＋ 참조 추가</Text>
            </TouchableOpacity>
          )}

          <View style={styles.fieldRow}>
            <Text style={styles.label}>제목</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="제목"
              placeholderTextColor={c.placeholder}
              style={styles.input}
            />
          </View>

          {/* 첨부 표시 */}
          {attachments.length > 0 && (
            <View style={styles.attachList}>
              {attachments.map((a, i) => (
                <View key={i} style={styles.attachChip}>
                  <Text style={styles.attachChipName} numberOfLines={1}>{a.name}</Text>
                  <Text style={styles.attachChipSize}>{fmtBytes(a.size)}</Text>
                  <TouchableOpacity onPress={() => removeAttachment(i)} style={styles.attachRemove}>
                    <Text style={styles.attachRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* 첨부 도구 */}
          <View style={styles.attachTools}>
            <TouchableOpacity onPress={pickImage} style={styles.toolBtn}>
              <Text style={styles.toolIcon}>🖼</Text>
              <Text style={styles.toolLabel}>사진</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={pickFile} style={styles.toolBtn}>
              <Text style={styles.toolIcon}>📎</Text>
              <Text style={styles.toolLabel}>파일</Text>
            </TouchableOpacity>
          </View>

          {/* 본문 */}
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="내용을 입력하세요..."
            placeholderTextColor={c.placeholder}
            multiline
            textAlignVertical="top"
            style={styles.bodyInput}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function fmtBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  label: { width: 70, fontSize: 13, fontWeight: '600', color: c.textMuted },
  input: { flex: 1, fontSize: 14, color: c.text, padding: 0 },

  ccToggle: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.divider },
  ccToggleText: { fontSize: 12, color: COLORS.primary[500], fontWeight: '600' },

  attachList: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap' },
  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.surfaceAlt, borderRadius: 8, paddingLeft: 10, paddingRight: 4,
    paddingVertical: 4, maxWidth: 220,
    borderWidth: 1, borderColor: c.border,
  },
  attachChipName: { fontSize: 12, fontWeight: '500', color: c.text, maxWidth: 130 },
  attachChipSize: { fontSize: 10, color: c.textSubtle },
  attachRemove: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  attachRemoveText: { fontSize: 16, color: c.textMuted, fontWeight: '600' },

  attachTools: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, paddingVertical: 6 },
  toolBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.surfaceAlt },
  toolIcon: { fontSize: 14 },
  toolLabel: { fontSize: 12, color: c.text, fontWeight: '500' },

  bodyInput: {
    minHeight: 300, padding: 16, fontSize: 15, color: c.text, lineHeight: 22,
    backgroundColor: c.bg,
  },
});
