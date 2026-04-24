/**
 * CallKit PoC 테스트 화면 (개발 전용)
 *
 * - "수신 시뮬레이션" 버튼 → 로컬에서 displayIncomingCall 호출
 * - iOS 실기기/시뮬레이터에서 잠금화면 스타일 통화 UI 확인
 * - Android 실기기에서 Heads-up notification + ConnectionService UI 확인
 * - Expo Go 는 네이티브 모듈 로딩 실패 → 경고 로그만
 *
 * 접근: `/dev/callkit-test` 또는 더보기 메뉴에서 링크 (v1.0 전엔 비노출)
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../../src/constants/theme';
import { simulateIncomingCall, endIncomingCall } from '../../src/services/callkeep';

export default function CallKitTestScreen() {
  const [lastUuid, setLastUuid] = useState<string | null>(null);

  const trigger = () => {
    const uuid = simulateIncomingCall('demo-meeting-001');
    setLastUuid(uuid);
    Alert.alert(
      '가짜 수신 호출 트리거',
      `UUID: ${uuid}\n\nExpo Go 에서는 콘솔 로그만 출력됩니다.\n네이티브 빌드에서는 CallKit UI가 뜹니다.`,
    );
  };

  const hangup = () => {
    if (!lastUuid) return;
    endIncomingCall(lastUuid);
    setLastUuid(null);
  };

  return (
    <>
      <Stack.Screen options={{ title: 'CallKit PoC' }} />
      <View style={styles.container}>
        <Text style={styles.title}>🔔 수신 호출 테스트</Text>
        <Text style={styles.desc}>
          이 화면은 Phase 2 CallKit PoC 용입니다.{'\n'}
          아래 버튼을 누르면 react-native-callkeep 이{'\n'}
          displayIncomingCall 을 호출합니다.
        </Text>

        <TouchableOpacity style={styles.btn} onPress={trigger}>
          <Text style={styles.btnText}>📞 수신 시뮬레이션</Text>
        </TouchableOpacity>

        {lastUuid && (
          <>
            <Text style={styles.meta}>마지막 UUID: {lastUuid}</Text>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={hangup}>
              <Text style={[styles.btnText, styles.btnOutlineText]}>호출 종료</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.hints}>
          <Text style={styles.hintTitle}>ℹ️ 동작 환경</Text>
          <Text style={styles.hint}>• Expo Go: 로그만 출력 (네이티브 모듈 미탑재)</Text>
          <Text style={styles.hint}>• iOS dev build: 잠금화면 CallKit UI 표시</Text>
          <Text style={styles.hint}>• Android dev build: Heads-up 알림 + ConnectionService</Text>
          <Text style={styles.hint}>• 수락 시 /meeting/demo-meeting-001 로 라우팅</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.gray[800] },
  desc: { fontSize: 13, color: COLORS.gray[600], lineHeight: 20, marginBottom: 8 },
  btn: {
    backgroundColor: COLORS.primary[500],
    paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4,
  },
  btnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  btnOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.gray[300] },
  btnOutlineText: { color: COLORS.gray[700] },
  meta: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: COLORS.gray[500],
    backgroundColor: COLORS.gray[50], padding: 10, borderRadius: 8,
  },
  hints: { marginTop: 20, padding: 14, backgroundColor: '#fffbeb', borderRadius: 12 },
  hintTitle: { fontSize: 12, fontWeight: '700', color: '#92400e', marginBottom: 6 },
  hint: { fontSize: 12, color: '#92400e', lineHeight: 18 },
});
