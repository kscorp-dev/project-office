import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import { useAuthStore } from '../src/store/auth';

const ROLE_LABEL: Record<string, string> = {
  super_admin: '최고관리자',
  admin: '관리자',
  dept_admin: '부서관리자',
  user: '일반사용자',
  guest: '게스트',
};

export default function ProfileScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
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
          <InfoRow styles={styles} label="사번" value={user?.employeeId} />
          <InfoRow styles={styles} label="이메일" value={user?.email} />
          <InfoRow styles={styles} label="역할" value={user?.role ? ROLE_LABEL[user.role] ?? user.role : '-'} />
          <InfoRow styles={styles} label="상태" value={user?.status || '-'} />
        </View>
      </ScrollView>
    </>
  );
}

function InfoRow({ label, value, styles }: { label: string; value?: string | null; styles: any }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value || '-'}</Text>
    </View>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  card: { backgroundColor: c.surface, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 12 },
  avatarBig: { width: 80, height: 80, borderRadius: 20, backgroundColor: COLORS.primary[500], justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarBigText: { color: COLORS.white, fontSize: 32, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '700', color: c.text },
  position: { fontSize: 13, color: c.textMuted, marginTop: 4 },
  infoCard: { backgroundColor: c.surface, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowLabel: { color: c.textMuted, fontSize: 13 },
  rowValue: { color: c.text, fontSize: 13, fontWeight: '500' },
});
