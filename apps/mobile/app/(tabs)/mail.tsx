import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import api from '../../src/services/api';

interface MailItem {
  uid: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  snippet: string;
  sentAt: string;
  isSeen: boolean;
  isFlagged: boolean;
  hasAttachment: boolean;
}

export default function MailScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [mails, setMails] = useState<MailItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accountLinked, setAccountLinked] = useState<boolean | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // 계정 연결 여부 확인 → 연결되어 있으면 INBOX 로드
  const fetchMessages = useCallback(async (opts: { forceRefresh?: boolean; searchQuery?: string } = {}) => {
    setLoading(true);
    setAccountError(null);
    try {
      const qs = new URLSearchParams({ folder: 'INBOX', limit: '30' });
      if (opts.forceRefresh) qs.set('refresh', '1');
      if (opts.searchQuery) qs.set('search', opts.searchQuery);
      const res = await api.get(`/mail/messages?${qs.toString()}`);
      setMails(res.data?.data ?? []);
      setAccountLinked(true);
    } catch (err: any) {
      const code = err.response?.data?.error?.code;
      if (code === 'MAIL_ACCOUNT_NOT_LINKED') {
        setAccountLinked(false);
      } else {
        setAccountError(err.response?.data?.error?.message || '메일 조회 실패');
        setAccountLinked(true); // UI 상태는 연결은 되어 있지만 오류 상태
      }
      setMails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMessages({ forceRefresh: true });
    setRefreshing(false);
  };

  const onSearch = async (q: string) => {
    setSearch(q);
    // 2글자 이상부터 서버 검색 (간단 UX)
    if (q.length === 0) {
      fetchMessages();
    } else if (q.length >= 2) {
      fetchMessages({ searchQuery: q });
    }
  };

  const unreadCount = mails.filter((m) => !m.isSeen).length;

  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (isYesterday) return '어제';
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const senderName = (m: MailItem) => m.fromName || m.fromEmail || '(발신자 없음)';

  if (accountLinked === false) {
    return (
      <View style={styles.container}>
        <View style={styles.stateBox}>
          <Text style={styles.stateEmoji}>📭</Text>
          <Text style={styles.stateTitle}>메일 계정이 연결되지 않았습니다</Text>
          <Text style={styles.stateHint}>
            관리자에게 WorkMail 계정 연결을 요청하거나,{'\n'}웹 앱의 메일 설정에서 IMAP/SMTP 자격을 입력해 주세요.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="메일 검색 (2글자 이상)"
          placeholderTextColor={COLORS.gray[400]}
          value={search}
          onChangeText={onSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.statsText}>받은편지함 ({unreadCount}개 안읽음)</Text>
      </View>

      {accountError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{accountError}</Text>
        </View>
      )}

      <ScrollView
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary[500]} />}
      >
        {loading && mails.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={COLORS.primary[500]} />
          </View>
        ) : mails.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{search ? '검색 결과가 없습니다' : '메일이 없습니다'}</Text>
          </View>
        ) : (
          mails.map((mail) => (
            <TouchableOpacity
              key={mail.uid}
              style={[styles.mailRow, !mail.isSeen && styles.mailUnread]}
              activeOpacity={0.7}
            >
              <View style={styles.mailAvatar}>
                <Text style={styles.mailAvatarText}>{senderName(mail)[0]?.toUpperCase()}</Text>
              </View>
              <View style={styles.mailContent}>
                <View style={styles.mailHeader}>
                  <Text style={[styles.mailFrom, !mail.isSeen && styles.bold]} numberOfLines={1}>
                    {senderName(mail)}
                  </Text>
                  <Text style={styles.mailDate}>{fmtTime(mail.sentAt)}</Text>
                </View>
                <Text style={[styles.mailSubject, !mail.isSeen && styles.bold]} numberOfLines={1}>
                  {mail.subject || '(제목 없음)'}
                </Text>
                <Text style={styles.mailPreview} numberOfLines={1}>
                  {mail.hasAttachment ? '📎 ' : ''}{mail.snippet || ''}
                </Text>
              </View>
              <View style={styles.mailIndicators}>
                {mail.isFlagged && <Text style={styles.star}>★</Text>}
                {!mail.isSeen && <View style={styles.unreadDot} />}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput: {
    backgroundColor: c.surfaceAlt, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, color: c.text, borderWidth: 1, borderColor: c.border,
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  statsText: { fontSize: 13, color: c.textMuted },
  errorBox: {
    marginHorizontal: 16, padding: 10,
    backgroundColor: isDark ? '#3a0f10' : '#fef2f2',
    borderRadius: 10,
    borderWidth: 1, borderColor: isDark ? '#7f1d1d' : '#fecaca',
    marginBottom: 6,
  },
  errorText: { fontSize: 12, color: isDark ? '#fca5a5' : '#991b1b' },
  list: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: c.textSubtle },
  mailRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  mailUnread: { backgroundColor: c.highlight },
  mailAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  mailAvatarText: { fontSize: 16, fontWeight: '700', color: COLORS.white },
  mailContent: { flex: 1 },
  mailHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  mailFrom: { fontSize: 14, color: c.text, flex: 1, marginRight: 8 },
  mailDate: { fontSize: 11, color: c.textSubtle },
  mailSubject: { fontSize: 14, color: c.text, marginBottom: 2 },
  mailPreview: { fontSize: 12, color: c.textSubtle },
  bold: { fontWeight: '700' },
  mailIndicators: { alignItems: 'center', gap: 4, marginLeft: 8 },
  star: { fontSize: 14, color: '#f59e0b' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary[500] },
  stateBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  stateEmoji: { fontSize: 48, marginBottom: 16 },
  stateTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 8, textAlign: 'center' },
  stateHint: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
});
