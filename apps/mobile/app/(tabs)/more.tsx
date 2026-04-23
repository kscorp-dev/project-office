import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/auth';
import { COLORS } from '../../src/constants/theme';

const MENU_SECTIONS = [
  {
    title: '업무 관리',
    items: [
      { key: 'organization', label: '조직도',       emoji: '👥' },
      { key: 'attendance',   label: '근무관리',     emoji: '⏰' },
      { key: 'calendar',     label: '캘린더',       emoji: '📅' },
      { key: 'board',        label: '게시판',       emoji: '📰' },
    ],
  },
  {
    title: '운영 관리',
    items: [
      { key: 'taskorders', label: '작업지시서',   emoji: '📋' },
      { key: 'inventory',  label: '자재관리',     emoji: '📦' },
      { key: 'parking',    label: '주차관리',     emoji: '🚗' },
      { key: 'cctv',       label: 'CCTV',         emoji: '📹' },
    ],
  },
  {
    title: '커뮤니케이션',
    items: [
      { key: 'meeting',   label: '화상회의',     emoji: '🎥' },
      { key: 'documents', label: '문서관리',     emoji: '📁' },
    ],
  },
  {
    title: '설정',
    items: [
      { key: 'calendar-sync', label: '외부 캘린더 연동', emoji: '🗓️' },
      { key: 'profile',   label: '내 정보',      emoji: '👤' },
      { key: 'settings',  label: '앱 설정',      emoji: '⚙️' },
      { key: 'admin',     label: '관리콘솔',     emoji: '🔧' },
    ],
  },
];

export default function MoreScreen() {
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: () => {
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleMenuPress = (key: string) => {
    // 구현된 라우트로 연결
    if (key === 'meeting') {
      router.push('/meeting');
      return;
    }
    if (key === 'calendar-sync') {
      router.push('/settings/calendar-sync');
      return;
    }
    Alert.alert('준비 중', `${key} 기능은 준비 중입니다.`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 프로필 카드 */}
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{user?.name?.[0] || 'U'}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user?.name || '사용자'}</Text>
          <Text style={styles.profileDept}>{user?.department?.name || user?.position || '(주)KS코퍼레이션'}</Text>
          <Text style={styles.profileId}>{user?.employeeId || ''}</Text>
        </View>
      </View>

      {/* 메뉴 섹션 */}
      {MENU_SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={styles.menuGrid}>
            {section.items.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.menuItem}
                onPress={() => handleMenuPress(item.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.menuEmoji}>{item.emoji}</Text>
                <Text style={styles.menuLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      {/* 로그아웃 */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>로그아웃</Text>
      </TouchableOpacity>

      {/* 버전 */}
      <Text style={styles.version}>Project Office v0.4.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white,
    borderRadius: 20, padding: 20, marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  profileAvatar: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: COLORS.primary[500],
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  profileAvatarText: { fontSize: 24, fontWeight: '700', color: COLORS.white },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: COLORS.gray[800] },
  profileDept: { fontSize: 13, color: COLORS.gray[500], marginTop: 2 },
  profileId: { fontSize: 11, color: COLORS.gray[400], marginTop: 2 },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.gray[500], marginBottom: 10, paddingLeft: 4 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  menuItem: {
    width: '23%' as any, backgroundColor: COLORS.white, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  menuEmoji: { fontSize: 26, marginBottom: 6 },
  menuLabel: { fontSize: 11, fontWeight: '600', color: COLORS.gray[700] },

  logoutBtn: {
    backgroundColor: COLORS.white, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    marginTop: 8, borderWidth: 1, borderColor: COLORS.gray[200],
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: COLORS.danger },

  version: { textAlign: 'center', fontSize: 11, color: COLORS.gray[400], marginTop: 16 },
});
