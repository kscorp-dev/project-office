import { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Alert, TouchableOpacity, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';
import { useAuthStore } from '../src/store/auth';

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  todayLogins: number;
  pendingApprovals: number;
}

interface ModuleEntry {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  isEnabled: boolean;
  isCritical?: boolean;
}

export default function AdminScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  const isSuperAdmin = user?.role === 'super_admin';

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        api.get('/admin/stats/dashboard'),
        api.get('/admin/modules'),
      ]);
      setStats(s.data?.data ?? null);
      setModules(m.data?.data ?? []);
    } catch (err: any) {
      if (err.response?.status === 403) {
        Alert.alert('접근 권한 없음', '관리자 권한이 필요합니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) fetch(); }, [isAdmin]);

  const toggleModule = async (mod: ModuleEntry) => {
    if (mod.isCritical && !isSuperAdmin) {
      Alert.alert('권한 부족', `${mod.displayName}은(는) 슈퍼 관리자만 제어할 수 있습니다`);
      return;
    }
    if (mod.name === 'admin' && mod.isEnabled) {
      Alert.alert('보호됨', '관리자콘솔은 비활성화할 수 없습니다');
      return;
    }
    try {
      await api.patch(`/admin/modules/${mod.id}`, { isEnabled: !mod.isEnabled });
      setModules((prev) => prev.map((m) => m.id === mod.id ? { ...m, isEnabled: !m.isEnabled } : m));
    } catch (err: any) {
      Alert.alert('실패', err.response?.data?.error?.message || '토글 실패');
    }
  };

  if (!isAdmin) {
    return (
      <>
        <Stack.Screen options={{ title: '관리콘솔' }} />
        <View style={styles.centerBox}>
          <Text style={styles.empty}>관리자 권한이 필요합니다</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: '관리콘솔' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
      >
        {loading && !stats ? <ActivityIndicator color={COLORS.primary[500]} /> : (
          <>
            {stats && (
              <View style={styles.statGrid}>
                <StatCell styles={styles} label="전체 사용자" value={stats.totalUsers} />
                <StatCell styles={styles} label="활성 사용자" value={stats.activeUsers} />
                <StatCell styles={styles} label="오늘 로그인" value={stats.todayLogins} />
                <StatCell styles={styles} label="대기중 결재" value={stats.pendingApprovals} />
              </View>
            )}

            <Text style={styles.sectionTitle}>모듈 관리 ({modules.length})</Text>
            <Text style={styles.hint}>
              스위치를 누르면 즉시 적용됩니다. 슈퍼관리자 전용 모듈(CCTV/근태/주차)은
              슈퍼 관리자만 변경할 수 있습니다.
            </Text>

            <View style={styles.card}>
              {modules.map((mod) => {
                const locked = mod.isCritical && !isSuperAdmin;
                return (
                  <TouchableOpacity
                    key={mod.id}
                    onPress={() => toggleModule(mod)}
                    disabled={locked}
                    style={[styles.modRow, locked && styles.modRowLocked]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modName}>
                        {mod.displayName}
                        {mod.isCritical && <Text style={styles.modCritical}> · 슈퍼</Text>}
                      </Text>
                      <Text style={styles.modId}>{mod.name}</Text>
                    </View>
                    <View style={[styles.toggle, mod.isEnabled ? styles.toggleOn : styles.toggleOff]}>
                      <View style={[styles.toggleKnob, mod.isEnabled && styles.toggleKnobOn]} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function StatCell({ label, value, styles }: { label: string; value: number; styles: any }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { color: c.textSubtle },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCell: { width: '47%', backgroundColor: c.surface, padding: 16, borderRadius: 14, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '700', color: COLORS.primary[500] },
  statLabel: { fontSize: 12, color: c.textMuted, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 20, marginBottom: 6 },
  hint: { fontSize: 11, color: c.textMuted, marginBottom: 10 },
  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' },
  modRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 12 },
  modRowLocked: { opacity: 0.55 },
  modName: { fontSize: 14, fontWeight: '600', color: c.text },
  modCritical: { color: '#b45309', fontSize: 10 },
  modId: { fontSize: 11, color: c.textSubtle, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
  toggle: { width: 44, height: 24, borderRadius: 12, padding: 2 },
  toggleOn: { backgroundColor: '#10b981' },
  toggleOff: { backgroundColor: c.border },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffffff' },
  toggleKnobOn: { transform: [{ translateX: 20 }] },
});
