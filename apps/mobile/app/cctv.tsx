import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import api from '../src/services/api';

interface CameraItem {
  id: string;
  name: string;
  location?: string | null;
  isPtz: boolean;
  status: string;
  groupId?: string | null;
  group?: { id: string; name: string } | null;
}

interface CameraGroup {
  id: string;
  name: string;
  cameras: CameraItem[];
}

export default function CCTVScreen() {
  const [groups, setGroups] = useState<CameraGroup[]>([]);
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([api.get('/cctv/groups'), api.get('/cctv/cameras')]);
      setGroups(g.data?.data ?? []);
      setCameras(c.data?.data ?? []);
    } catch {
      setGroups([]);
      setCameras([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, []);

  const ungrouped = cameras.filter((c) => !c.groupId);

  return (
    <>
      <Stack.Screen options={{ title: 'CCTV' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(); setRefreshing(false); }} />}
      >
        {loading ? <ActivityIndicator color={COLORS.primary[500]} /> : cameras.length === 0 ? (
          <View style={styles.centerBox}>
            <Text style={styles.empty}>접근 권한이 있는 카메라가 없습니다</Text>
          </View>
        ) : (
          <>
            <Text style={styles.hint}>
              ℹ️ 모바일 앱은 카메라 목록만 표시합니다. 실시간 영상은 웹에서 확인하세요.
            </Text>

            {groups.map((g) => g.cameras.length > 0 && (
              <View key={g.id} style={{ marginBottom: 12 }}>
                <Text style={styles.sectionTitle}>{g.name}</Text>
                <View style={styles.card}>
                  {g.cameras.map((cam) => <CameraRow key={cam.id} cam={cam} />)}
                </View>
              </View>
            ))}
            {ungrouped.length > 0 && (
              <View>
                <Text style={styles.sectionTitle}>미분류</Text>
                <View style={styles.card}>
                  {ungrouped.map((cam) => <CameraRow key={cam.id} cam={cam} />)}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function CameraRow({ cam }: { cam: CameraItem }) {
  const online = cam.status === 'online';
  return (
    <View style={styles.camRow}>
      <View style={[styles.dot, { backgroundColor: online ? '#10b981' : '#ef4444' }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.camName}>{cam.name}</Text>
        {cam.location && <Text style={styles.camMeta}>📍 {cam.location}</Text>}
      </View>
      {cam.isPtz && <Text style={styles.ptzBadge}>PTZ</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centerBox: { padding: 60, alignItems: 'center' },
  empty: { color: COLORS.gray[400] },
  hint: { fontSize: 11, color: COLORS.gray[500], backgroundColor: '#fef3c7', padding: 10, borderRadius: 10, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.gray[700], marginBottom: 6 },
  card: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden' },
  camRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50], gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  camName: { fontSize: 14, fontWeight: '600', color: COLORS.gray[800] },
  camMeta: { fontSize: 11, color: COLORS.gray[400], marginTop: 2 },
  ptzBadge: { fontSize: 10, fontWeight: '700', color: COLORS.primary[700], backgroundColor: COLORS.primary[50], paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
});
