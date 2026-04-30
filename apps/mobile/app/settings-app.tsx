import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { type SemanticColors } from '../src/constants/theme';
import { API_BASE_URL } from '../src/services/api';
import Constants from 'expo-constants';

export default function SettingsAppScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? '0.4.0';
  const buildNumber = (Constants.expoConfig?.ios?.buildNumber as string | undefined)
    ?? String(Constants.expoConfig?.android?.versionCode ?? '1');

  return (
    <>
      <Stack.Screen options={{ title: '앱 설정' }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <Section styles={styles} title="결재">
          <Row styles={styles} label="결재 위임 (대결자 지정)" onPress={() => router.push('/settings/delegation' as any)} chevron />
        </Section>

        <Section styles={styles} title="알림 & 동기화">
          <Row styles={styles} label="외부 캘린더 연동" onPress={() => router.push('/settings/calendar-sync')} chevron />
          <Row styles={styles} label="푸시 알림 설정" onPress={() => Alert.alert('준비 중', 'OS 설정 앱에서 알림을 관리해 주세요')} chevron />
        </Section>

        <Section styles={styles} title="정보">
          <Row styles={styles} label="앱 버전" value={`v${appVersion} (build ${buildNumber})`} />
          <Row styles={styles} label="API 서버" value={API_BASE_URL} />
        </Section>

        <Section styles={styles} title="지원">
          <Row styles={styles} label="피드백 / 문의" onPress={() => Alert.alert('이메일', '관리자에게 사내 메일로 문의해 주세요')} chevron />
        </Section>
      </ScrollView>
    </>
  );
}

function Section({ title, children, styles }: { title: string; children: React.ReactNode; styles: any }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, onPress, chevron, styles }: { label: string; value?: string; onPress?: () => void; chevron?: boolean; styles: any }) {
  const Comp: any = onPress ? TouchableOpacity : View;
  return (
    <Comp onPress={onPress} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {value && <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>}
      {chevron && <Text style={styles.chevron}>›</Text>}
    </Comp>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted, marginBottom: 6, paddingHorizontal: 4, textTransform: 'uppercase' },
  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 10 },
  rowLabel: { flex: 1, fontSize: 14, color: c.text },
  rowValue: { fontSize: 12, color: c.textMuted, maxWidth: 180 },
  chevron: { fontSize: 22, color: c.textSubtle, fontWeight: '300' },
});
