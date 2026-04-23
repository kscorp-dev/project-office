import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import { API_BASE_URL } from '../src/services/api';
import Constants from 'expo-constants';

export default function SettingsAppScreen() {
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? '0.4.0';
  const buildNumber = (Constants.expoConfig?.ios?.buildNumber as string | undefined)
    ?? String(Constants.expoConfig?.android?.versionCode ?? '1');

  return (
    <>
      <Stack.Screen options={{ title: '앱 설정' }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <Section title="알림 & 동기화">
          <Row label="외부 캘린더 연동" onPress={() => router.push('/settings/calendar-sync')} chevron />
          <Row label="푸시 알림 설정" onPress={() => Alert.alert('준비 중', 'OS 설정 앱에서 알림을 관리해 주세요')} chevron />
        </Section>

        <Section title="정보">
          <Row label="앱 버전" value={`v${appVersion} (build ${buildNumber})`} />
          <Row label="API 서버" value={API_BASE_URL} />
        </Section>

        <Section title="지원">
          <Row label="피드백 / 문의" onPress={() => Alert.alert('이메일', '관리자에게 사내 메일로 문의해 주세요')} chevron />
        </Section>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, onPress, chevron }: { label: string; value?: string; onPress?: () => void; chevron?: boolean }) {
  const Comp: any = onPress ? TouchableOpacity : View;
  return (
    <Comp onPress={onPress} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {value && <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>}
      {chevron && <Text style={styles.chevron}>›</Text>}
    </Comp>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.gray[500], marginBottom: 6, paddingHorizontal: 4, textTransform: 'uppercase' },
  card: { backgroundColor: COLORS.white, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.gray[50], gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, color: COLORS.gray[800] },
  rowValue: { fontSize: 12, color: COLORS.gray[500], maxWidth: 180 },
  chevron: { fontSize: 22, color: COLORS.gray[300], fontWeight: '300' },
});
