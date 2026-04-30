import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';

interface Dept {
  id: string;
  name: string;
  code: string;
  depth: number;
  _count?: { users?: number; children?: number };
}

interface UserLite {
  id: string;
  name: string;
  position?: string | null;
  email: string;
  department?: { id: string; name: string } | null;
}

export default function OrganizationScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const [dRes, uRes] = await Promise.all([
        api.get('/departments'),
        api.get('/users?limit=100'),
      ]);
      setDepts(dRes.data?.data ?? []);
      setUsers(uRes.data?.data ?? []);
    } catch {
      setDepts([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, []);

  return (
    <>
      <Stack.Screen options={{ title: '조직도' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
      >
        <Text style={styles.sectionTitle}>부서 ({depts.length})</Text>
        <View style={styles.card}>
          {loading ? <ActivityIndicator color={COLORS.primary[500]} /> : depts.length === 0 ? (
            <Text style={styles.empty}>부서가 없습니다</Text>
          ) : (
            depts.map((d) => (
              <View key={d.id} style={[styles.row, { paddingLeft: 12 + d.depth * 16 }]}>
                <Text style={styles.rowTitle}>{d.name}</Text>
                <Text style={styles.rowMeta}>{d.code} {d._count?.users !== undefined && `· ${d._count.users}명`}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>직원 ({users.length})</Text>
        <View style={styles.card}>
          {users.map((u) => (
            <View key={u.id} style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{u.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.name}</Text>
                <Text style={styles.userMeta}>
                  {u.department?.name ?? '부서 없음'}{u.position ? ` · ${u.position}` : ''}
                </Text>
                <Text style={styles.userEmail}>{u.email}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginBottom: 8, marginTop: 16 },
  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' },
  row: { paddingVertical: 12, paddingRight: 16, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowTitle: { fontSize: 14, color: c.text, fontWeight: '600' },
  rowMeta: { fontSize: 11, color: c.textSubtle, marginTop: 2 },
  empty: { padding: 24, textAlign: 'center', color: c.textSubtle },
  userRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  avatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primary[500], justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { color: '#ffffff', fontWeight: '700' },
  userName: { fontSize: 14, fontWeight: '600', color: c.text },
  userMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  userEmail: { fontSize: 11, color: c.textSubtle, marginTop: 1 },
});
