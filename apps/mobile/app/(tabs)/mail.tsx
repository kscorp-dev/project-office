import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { COLORS } from '../../src/constants/theme';

interface MailItem {
  id: string;
  from: string;
  subject: string;
  preview: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
}

const DEMO_MAILS: MailItem[] = [
  { id: '1', from: '김부장', subject: '4월 프로젝트 진행 현황 보고 요청', preview: '안녕하세요, 4월 프로젝트 진행 현황에 대한 보고서를...', date: '09:30', isRead: false, isStarred: true },
  { id: '2', from: '이대리', subject: 'Re: 화상회의 시스템 테스트 결과', preview: '테스트 결과 공유드립니다. 음성 인식 정확도...', date: '08:15', isRead: false, isStarred: false },
  { id: '3', from: '박과장', subject: '자재관리 시스템 업데이트 안내', preview: '자재관리 시스템이 v2.1로 업데이트...', date: '어제', isRead: true, isStarred: false },
  { id: '4', from: '최사원', subject: '신입사원 교육 일정 안내', preview: '4월 신입사원 교육 일정을 안내드립니다...', date: '어제', isRead: true, isStarred: false },
  { id: '5', from: '정차장', subject: '연차 사용 승인 완료', preview: '신청하신 연차가 승인되었습니다...', date: '4/7', isRead: true, isStarred: true },
];

export default function MailScreen() {
  const [mails, setMails] = useState(DEMO_MAILS);
  const [search, setSearch] = useState('');

  const filtered = mails.filter(
    (m) => !search || m.subject.includes(search) || m.from.includes(search)
  );
  const unread = mails.filter((m) => !m.isRead).length;

  return (
    <View style={styles.container}>
      {/* 검색바 */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="메일 검색..."
          placeholderTextColor={COLORS.gray[400]}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* 통계 */}
      <View style={styles.statsRow}>
        <Text style={styles.statsText}>받은편지함 ({unread}개 안읽음)</Text>
        <TouchableOpacity>
          <Text style={styles.composeBtn}>+ 새 메일</Text>
        </TouchableOpacity>
      </View>

      {/* 메일 목록 */}
      <ScrollView style={styles.list}>
        {filtered.map((mail) => (
          <TouchableOpacity
            key={mail.id}
            style={[styles.mailRow, !mail.isRead && styles.mailUnread]}
            activeOpacity={0.7}
            onPress={() => setMails((p) => p.map((m) => m.id === mail.id ? { ...m, isRead: true } : m))}
          >
            <View style={styles.mailAvatar}>
              <Text style={styles.mailAvatarText}>{mail.from[0]}</Text>
            </View>
            <View style={styles.mailContent}>
              <View style={styles.mailHeader}>
                <Text style={[styles.mailFrom, !mail.isRead && styles.bold]}>{mail.from}</Text>
                <Text style={styles.mailDate}>{mail.date}</Text>
              </View>
              <Text style={[styles.mailSubject, !mail.isRead && styles.bold]} numberOfLines={1}>
                {mail.subject}
              </Text>
              <Text style={styles.mailPreview} numberOfLines={1}>{mail.preview}</Text>
            </View>
            <View style={styles.mailIndicators}>
              {mail.isStarred && <Text style={styles.star}>★</Text>}
              {!mail.isRead && <View style={styles.unreadDot} />}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput: {
    backgroundColor: COLORS.white, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, color: COLORS.gray[800], borderWidth: 1, borderColor: COLORS.gray[200],
  },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  statsText: { fontSize: 13, color: COLORS.gray[500] },
  composeBtn: { fontSize: 14, fontWeight: '600', color: COLORS.primary[600] },
  list: { flex: 1 },
  mailRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: COLORS.white, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50],
  },
  mailUnread: { backgroundColor: '#f0fdf4' },
  mailAvatar: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  mailAvatarText: { fontSize: 16, fontWeight: '700', color: COLORS.white },
  mailContent: { flex: 1 },
  mailHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  mailFrom: { fontSize: 14, color: COLORS.gray[700] },
  mailDate: { fontSize: 11, color: COLORS.gray[400] },
  mailSubject: { fontSize: 14, color: COLORS.gray[800], marginBottom: 2 },
  mailPreview: { fontSize: 12, color: COLORS.gray[400] },
  bold: { fontWeight: '700' },
  mailIndicators: { alignItems: 'center', gap: 4, marginLeft: 8 },
  star: { fontSize: 14, color: '#f59e0b' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary[500] },
});
