import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import { useAuthStore } from '../src/store/auth';

const ROLE_LABEL: Record<string, string> = {
  super_admin: '최고관리자',
  admin: '관리자',
  dept_admin: '부서관리자',
  user: '일반사용자',
  guest: '게스트',
};

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);

  return (
    <>
      <Stack.Screen options={{ title: '내 정보' }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <View style={styles.card}>
          <View style={styles.avatarBig}>
            <Text style={styles.avatarBigText}>{user?.name?.[0] || 'U'}</Text>
          </View>
          <Text style={styles.name}>{user?.name || '-'}</Text>
          <Text style={styles.position}>
            {user?.department?.name || '부서 없음'}{user?.position ? ` · ${user.position}` : ''}
          </Text>
        </View>

        <View style={styles.infoCard}>
          <InfoRow label="사번" value={user?.employeeId} />
          <InfoRow label="이메일" value={user?.email} />
          <InfoRow label="역할" value={user?.role ? ROLE_LABEL[user.role] ?? user.role : '-'} />
          <InfoRow label="상태" value={user?.status || '-'} />
        </View>
      </ScrollView>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '-'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: COLORS.white, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 12 },
  avatarBig: { width: 80, height: 80, borderRadius: 20, backgroundColor: COLORS.primary[500], justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarBigText: { color: COLORS.white, fontSize: 32, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700', color: COLORS.gray[800] },
  position: { fontSize: 13, color: COLORS.gray[500], marginTop: 4 },
  infoCard: { backgroundColor: COLORS.white, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50] },
  rowLabel: { color: COLORS.gray[500], fontSize: 13 },
  rowValue: { color: COLORS.gray[800], fontSize: 13, fontWeight: '500' },
});
