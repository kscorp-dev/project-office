/**
 * 출퇴근 GPS Bottom Sheet (Phase 1 Week 4 — 부록 A.5)
 *
 * 흐름:
 *   1. 모달 열기 → 즉시 expo-location 으로 좌표 취득 시도
 *   2. /attendance/geofence 로 사무실 좌표 + 반경 조회
 *   3. 거리 표시 → "범위 안 / 밖" 시각화
 *   4. 출/퇴근 버튼 → POST /attendance/check
 *      · 반경 안 → 즉시 성공
 *      · 반경 밖 + 사유 미입력 → 백엔드 400 OUT_OF_GEOFENCE → 사유 입력 단계로
 *      · 사유 입력 후 재시도 → 201 (offsite=true)
 *
 * 호출 측은 onSuccess 로 dashboard / attendance 화면을 갱신.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { COLORS, SPACING, RADIUS, type SemanticColors } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useLocation, LocationError, type CurrentLocation } from '../hooks/useLocation';
import api from '../services/api';

interface GeofenceConfig {
  enabled: boolean;
  configured: boolean;
  radiusM: number;
  officeLat: number | null;
  officeLng: number | null;
}

interface Props {
  visible: boolean;
  type: 'check_in' | 'check_out';
  onClose: () => void;
  onSuccess: () => void;
}

type Stage = 'loading' | 'ready' | 'submitting' | 'reason-required' | 'error';

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function AttendanceCheckSheet({ visible, type, onClose, onSuccess }: Props) {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const { getCurrentLocation } = useLocation();

  const [stage, setStage] = useState<Stage>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [location, setLocation] = useState<CurrentLocation | null>(null);
  const [geofence, setGeofence] = useState<GeofenceConfig | null>(null);
  const [reason, setReason] = useState('');
  const [forceOffsiteFlow, setForceOffsiteFlow] = useState(false);

  // 시트가 열릴 때마다 초기화 + 위치 + geofence 동시 로드
  useEffect(() => {
    if (!visible) return;
    setStage('loading');
    setErrorMessage('');
    setLocationError(null);
    setReason('');
    setForceOffsiteFlow(false);
    setLocation(null);

    let cancelled = false;
    (async () => {
      // Promise.allSettled — 위치 실패해도 geofence 정보는 받아둔다
      const [locRes, geoRes] = await Promise.allSettled([
        getCurrentLocation(),
        api.get('/attendance/geofence'),
      ]);
      if (cancelled) return;

      if (locRes.status === 'fulfilled') {
        setLocation(locRes.value);
      } else {
        const err = locRes.reason as LocationError;
        setLocationError(err?.message ?? '위치 정보를 받지 못했습니다');
      }

      if (geoRes.status === 'fulfilled') {
        setGeofence(geoRes.value.data?.data ?? null);
      } else {
        setGeofence({ enabled: false, configured: false, radiusM: 200, officeLat: null, officeLng: null });
      }

      setStage('ready');
    })();

    return () => { cancelled = true; };
  }, [visible, getCurrentLocation]);

  // 클라이언트 사전 거리 계산 (UX용 — 서버가 최종 판정)
  const distanceM: number | null = useMemo(() => {
    if (!location || !geofence?.officeLat || !geofence?.officeLng) return null;
    return haversineMeters(geofence.officeLat, geofence.officeLng, location.latitude, location.longitude);
  }, [location, geofence]);

  const inside =
    geofence && geofence.enabled && distanceM !== null
      ? distanceM <= geofence.radiusM
      : null; // null = 미정 (정책 비활성 또는 좌표 없음)

  const submit = async () => {
    setStage('submitting');
    setErrorMessage('');
    try {
      const body: Record<string, unknown> = { type };
      if (location) {
        body.latitude = location.latitude;
        body.longitude = location.longitude;
      }
      if (forceOffsiteFlow && reason.trim()) {
        body.note = reason.trim();
      }
      await api.post('/attendance/check', body);
      onSuccess();
      onClose();
    } catch (err: any) {
      const code = err.response?.data?.error?.code;
      const message = err.response?.data?.error?.message ?? '처리 실패';
      if (code === 'OUT_OF_GEOFENCE') {
        // 사유 입력 단계로 전환
        setForceOffsiteFlow(true);
        setStage('reason-required');
        setErrorMessage(message);
      } else if (code === 'ALREADY_CHECKED') {
        setErrorMessage(message);
        setStage('error');
      } else {
        setErrorMessage(message);
        setStage('error');
      }
    }
  };

  const typeLabel = type === 'check_in' ? '출근' : '퇴근';

  // ─── 단계별 UI ───

  function StatusBlock() {
    if (stage === 'loading') {
      return (
        <View style={styles.statusCenter}>
          <ActivityIndicator size="large" color={COLORS.primary[500]} />
          <Text style={styles.statusText}>위치 확인 중...</Text>
        </View>
      );
    }

    return (
      <View style={styles.statusBlock}>
        {/* 위치 카드 */}
        <View style={[styles.locCard, locationError ? styles.locCardError : null]}>
          {locationError ? (
            <>
              <Text style={styles.locTitle}>📍 위치 정보 없음</Text>
              <Text style={styles.locDesc}>{locationError}</Text>
            </>
          ) : (
            <>
              <Text style={styles.locTitle}>📍 현재 위치 확인됨</Text>
              <Text style={styles.locCoord}>
                {location!.latitude.toFixed(6)}, {location!.longitude.toFixed(6)}
                {location!.accuracy && ` · 정확도 ±${Math.round(location!.accuracy)}m`}
                {location!.fromCache && ' · 캐시'}
              </Text>
            </>
          )}
        </View>

        {/* 지오펜스 카드 */}
        {geofence?.enabled && geofence.configured && distanceM !== null && (
          <View
            style={[
              styles.geoCard,
              inside ? styles.geoCardOk : styles.geoCardWarn,
            ]}
          >
            <Text style={[styles.geoStatus, { color: inside ? COLORS.success : COLORS.warning }]}>
              {inside ? '✓ 사무실 반경 내' : '⚠️ 사무실 반경 밖'}
            </Text>
            <Text style={styles.geoMeta}>
              사무실까지 약 {Math.round(distanceM)}m / 허용 {geofence.radiusM}m
            </Text>
            {!inside && (
              <Text style={styles.geoHint}>
                반경 밖에서 {typeLabel}하려면 사유 입력이 필요합니다.
              </Text>
            )}
          </View>
        )}

        {geofence?.enabled === false && (
          <View style={styles.geoCardInfo}>
            <Text style={styles.geoMeta}>지오펜스 검증이 비활성화되어 있습니다 (위치만 기록).</Text>
          </View>
        )}

        {/* 사유 입력 (필요 시) */}
        {(stage === 'reason-required' || (forceOffsiteFlow && inside === false)) && (
          <View style={styles.reasonBlock}>
            <Text style={styles.reasonLabel}>사유 (필수)</Text>
            <TextInput
              style={styles.reasonInput}
              value={reason}
              onChangeText={setReason}
              placeholder="예: 출장, 외근, 재택근무 등"
              placeholderTextColor={c.placeholder}
              multiline
              maxLength={200}
              autoFocus
            />
          </View>
        )}

        {/* 에러 메시지 */}
        {!!errorMessage && stage !== 'reason-required' && (
          <Text style={styles.errorText}>{errorMessage}</Text>
        )}
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBg}
      >
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{typeLabel} 체크</Text>

          <StatusBlock />

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={onClose}>
              <Text style={styles.btnCancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                type === 'check_in' ? styles.btnPrimary : styles.btnSecondary,
                (stage === 'loading' || stage === 'submitting' || (stage === 'reason-required' && !reason.trim())) && styles.btnDisabled,
              ]}
              disabled={stage === 'loading' || stage === 'submitting' || (stage === 'reason-required' && !reason.trim())}
              onPress={submit}
            >
              {stage === 'submitting' ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.btnPrimaryText}>
                  {stage === 'reason-required' ? '사유로 ' + typeLabel : typeLabel}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  modalBg: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SPACING.xl, paddingTop: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? 36 : SPACING.xl,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.border,
    alignSelf: 'center', marginBottom: SPACING.md,
  },
  title: { fontSize: 20, fontWeight: '700', color: c.text, marginBottom: SPACING.lg },

  statusCenter: { alignItems: 'center', paddingVertical: SPACING.xl, gap: SPACING.sm },
  statusText: { fontSize: 13, color: c.textMuted },
  statusBlock: { gap: SPACING.md },

  locCard: {
    padding: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border,
  },
  locCardError: { borderColor: COLORS.warning, backgroundColor: isDark ? '#3a2a08' : '#fffbeb' },
  locTitle: { fontSize: 13, fontWeight: '600', color: c.text },
  locCoord: { fontSize: 11, color: c.textMuted, marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  locDesc: { fontSize: 12, color: isDark ? '#fcd34d' : '#92400e', marginTop: 4 },

  geoCard: {
    padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1,
  },
  geoCardOk: {
    backgroundColor: isDark ? '#13261c' : '#f0fdf4',
    borderColor: COLORS.primary[isDark ? 600 : 200],
  },
  geoCardWarn: {
    backgroundColor: isDark ? '#3a2a08' : '#fffbeb',
    borderColor: isDark ? '#7c5e0c' : '#fde68a',
  },
  geoCardInfo: {
    padding: SPACING.md, borderRadius: RADIUS.md,
    backgroundColor: c.surfaceAlt,
  },
  geoStatus: { fontSize: 14, fontWeight: '700' },
  geoMeta: { fontSize: 11, color: c.textMuted, marginTop: 4 },
  geoHint: { fontSize: 11, color: c.textMuted, marginTop: 6, fontStyle: 'italic' },

  reasonBlock: { gap: SPACING.xs },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  reasonInput: {
    backgroundColor: c.surfaceAlt,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border,
    padding: SPACING.md, fontSize: 14, color: c.text, minHeight: 64,
    textAlignVertical: 'top',
  },

  errorText: {
    fontSize: 12,
    color: isDark ? '#fca5a5' : '#dc2626',
    backgroundColor: isDark ? '#3a0f10' : '#fef2f2',
    borderWidth: 1, borderColor: isDark ? '#7f1d1d' : '#fecaca',
    padding: SPACING.sm, borderRadius: RADIUS.sm,
  },

  btnRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.lg },
  btn: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: COLORS.primary[500] },
  btnSecondary: { backgroundColor: '#f97316' },
  btnPrimaryText: { color: COLORS.white, fontWeight: '700', fontSize: 15 },
  btnCancel: { backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  btnCancelText: { color: c.textMuted, fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
});
