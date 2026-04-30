/**
 * 메일 상세 화면 (Phase 2 Week 5).
 *
 * - GET /mail/messages/:uid 로 본문/첨부 로드
 * - HTML 본문은 react-native 의 기본 Text 로 렌더 (간단 sanitize: 태그 제거)
 *   고급 렌더링은 WebView 또는 react-native-render-html 도입 시점에 교체
 * - 첨부 다운로드는 시스템 공유시트 (expo-file-system + Sharing)
 * - 답장(Reply) / 전체답장(ReplyAll) / 전달(Forward) — compose 화면으로 라우팅
 */
import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  TouchableOpacity, Alert, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import api, { API_BASE_URL } from '../../src/services/api';
import { useAuthStore } from '../../src/store/auth';

interface MailDetail {
  uid: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  to: Array<{ email: string; name?: string }>;
  cc: Array<{ email: string; name?: string }>;
  sentAt: string;
  text?: string;
  html?: string;
  attachments: Array<{ filename: string; size: number; contentType: string; index: number }>;
  isSeen: boolean;
  isFlagged: boolean;
}

export default function MailDetailScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [mail, setMail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const res = await api.get(`/mail/messages/${uid}?folder=INBOX`);
        setMail(res.data?.data ?? null);
      } catch (err: any) {
        Alert.alert('오류', err?.response?.data?.error?.message ?? '메일 조회 실패');
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [uid]);

  const downloadAttachment = async (att: MailDetail['attachments'][number]) => {
    if (!accessToken) return;
    try {
      setDownloadingIdx(att.index);
      const url = `${API_BASE_URL}/mail/messages/${uid}/attachments/${att.index}?folder=INBOX`;
      const safeName = att.filename.replace(/[^\w가-힣.\-]/g, '_');
      const dir = (FileSystem as any).cacheDirectory + 'mail/';
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const dest = dir + safeName;
      const dl = await FileSystem.downloadAsync(url, dest, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (dl.status >= 200 && dl.status < 300) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(dl.uri, { mimeType: att.contentType });
        } else {
          Alert.alert('저장됨', `다운로드 위치: ${dl.uri}`);
        }
      } else {
        Alert.alert('실패', `다운로드 실패 (HTTP ${dl.status})`);
      }
    } catch (err: any) {
      Alert.alert('실패', err?.message ?? '다운로드 실패');
    } finally {
      setDownloadingIdx(null);
    }
  };

  const goCompose = (mode: 'reply' | 'replyAll' | 'forward') => {
    if (!mail) return;
    router.push({
      pathname: '/mail/compose',
      params: {
        mode,
        sourceUid: mail.uid,
        subject: mail.subject,
        fromEmail: mail.fromEmail,
        fromName: mail.fromName ?? '',
        toEmails: mail.to.map((t) => t.email).join(','),
        ccEmails: mail.cc.map((t) => t.email).join(','),
        sentAt: mail.sentAt,
        bodyText: mail.text ?? stripHtml(mail.html ?? ''),
      },
    } as any);
  };

  if (loading || !mail) {
    return (
      <>
        <Stack.Screen options={{ title: '메일' }} />
        <View style={styles.loading}>
          <ActivityIndicator color={COLORS.primary[500]} />
        </View>
      </>
    );
  }

  // body: text 우선, 없으면 html → 태그 제거
  const body = mail.text || stripHtml(mail.html ?? '') || '(본문 없음)';

  return (
    <>
      <Stack.Screen options={{ title: '메일', headerTitleStyle: { fontSize: 16 } }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <Text style={styles.subject}>{mail.subject || '(제목 없음)'}</Text>

        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(mail.fromName || mail.fromEmail || '?')[0].toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fromName} numberOfLines={1}>
                {mail.fromName || mail.fromEmail}
              </Text>
              {mail.fromName ? (
                <Text style={styles.fromEmail} numberOfLines={1}>{mail.fromEmail}</Text>
              ) : null}
              <Text style={styles.dateLine}>{fmtDate(mail.sentAt)}</Text>
            </View>
          </View>
          {mail.to.length > 0 && (
            <Text style={styles.recipients} numberOfLines={2}>
              <Text style={styles.recipientsLabel}>받는 사람:</Text>{' '}
              {mail.to.map((t) => t.name || t.email).join(', ')}
            </Text>
          )}
          {mail.cc.length > 0 && (
            <Text style={styles.recipients} numberOfLines={2}>
              <Text style={styles.recipientsLabel}>참조:</Text>{' '}
              {mail.cc.map((t) => t.name || t.email).join(', ')}
            </Text>
          )}
        </View>

        {/* 첨부 */}
        {mail.attachments.length > 0 && (
          <View style={styles.attachCard}>
            <Text style={styles.sectionTitle}>첨부파일 ({mail.attachments.length})</Text>
            {mail.attachments.map((att) => (
              <TouchableOpacity
                key={att.index}
                style={styles.attachRow}
                onPress={() => downloadAttachment(att)}
                disabled={downloadingIdx === att.index}
              >
                <Text style={styles.attachIcon}>📎</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.attachName} numberOfLines={1}>{att.filename}</Text>
                  <Text style={styles.attachMeta}>
                    {fmtBytes(att.size)} · {att.contentType}
                  </Text>
                </View>
                {downloadingIdx === att.index ? (
                  <ActivityIndicator size="small" color={COLORS.primary[500]} />
                ) : (
                  <Text style={styles.attachAction}>저장</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* 본문 */}
        <View style={styles.bodyCard}>
          <Text style={styles.bodyText} selectable>{body}</Text>
        </View>
      </ScrollView>

      {/* 하단 액션 바 */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => goCompose('reply')}>
          <Text style={styles.actionIcon}>↩</Text>
          <Text style={styles.actionLabel}>답장</Text>
        </TouchableOpacity>
        {(mail.to.length > 1 || mail.cc.length > 0) && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => goCompose('replyAll')}>
            <Text style={styles.actionIcon}>↩↩</Text>
            <Text style={styles.actionLabel}>전체답장</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionBtn} onPress={() => goCompose('forward')}>
          <Text style={styles.actionIcon}>↪</Text>
          <Text style={styles.actionLabel}>전달</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

/** 매우 간단한 HTML → 텍스트 (script/style 제거 + 태그 제거 + 엔티티 일부 디코드) */
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
  container: { flex: 1, backgroundColor: c.bg },
  subject: { fontSize: 20, fontWeight: '700', color: c.text, lineHeight: 28, marginBottom: 16 },
  metaCard: {
    flexDirection: 'column', backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: isDark ? 1 : 0, borderColor: c.border,
    ...(isDark ? {} : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }),
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary[500], alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  fromName: { fontSize: 14, fontWeight: '700', color: c.text },
  fromEmail: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  dateLine: { fontSize: 11, color: c.textSubtle, marginTop: 2 },
  recipients: { fontSize: 12, color: c.textMuted, marginTop: 6, lineHeight: 18 },
  recipientsLabel: { fontWeight: '600', color: c.text },

  attachCard: {
    backgroundColor: c.surface, borderRadius: 14, padding: 12, marginBottom: 14,
    borderWidth: isDark ? 1 : 0, borderColor: c.border,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted, marginBottom: 8, textTransform: 'uppercase' },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  attachIcon: { fontSize: 18 },
  attachName: { fontSize: 13, fontWeight: '500', color: c.text },
  attachMeta: { fontSize: 10, color: c.textSubtle, marginTop: 2 },
  attachAction: { fontSize: 12, color: COLORS.primary[500], fontWeight: '700' },

  bodyCard: {
    backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 14,
    borderWidth: isDark ? 1 : 0, borderColor: c.border,
  },
  bodyText: { fontSize: 14, color: c.text, lineHeight: 22 },

  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 12, paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider,
  },
  actionBtn: { alignItems: 'center', paddingHorizontal: 18, paddingVertical: 6 },
  actionIcon: { fontSize: 20, color: COLORS.primary[500] },
  actionLabel: { fontSize: 11, color: c.textMuted, marginTop: 2 },
});
