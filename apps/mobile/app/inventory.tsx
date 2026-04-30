import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  TextInput, TouchableOpacity, Modal, Alert, Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from '../src/hooks/useTheme';
import { COLORS, type SemanticColors } from '../src/constants/theme';
import api from '../src/services/api';

interface InvItem {
  id: string;
  code: string;
  name: string;
  category?: { id: string; name: string } | null;
  currentStock: number;
  minStock?: number | null;
  unit?: string;
  location?: string | null;
  specification?: string | null;
}

export default function InventoryScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [items, setItems] = useState<InvItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanResult, setScanResult] = useState<InvItem | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const fetch = async (q = '') => {
    setLoading(true);
    try {
      const url = q ? `/inventory/items?search=${encodeURIComponent(q)}&limit=50` : '/inventory/items?limit=50';
      const res = await api.get(url);
      setItems(res.data?.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, []);

  const onSearch = (q: string) => {
    setSearch(q);
    if (q.length === 0 || q.length >= 2) fetch(q);
  };

  // 바코드/QR 스캔 결과 처리 — code 로 자재 lookup
  const onScanned = useCallback(async (code: string) => {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await api.get(`/inventory/lookup?code=${encodeURIComponent(code.trim())}`);
      setScanResult(res.data?.data ?? null);
      setScanError(null);
      setScannerOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? '조회 실패';
      setScanError(`"${code}" — ${msg}`);
      setScanResult(null);
      // 1.5초 뒤 자동 다시 스캔 가능
      setTimeout(() => setScanError(null), 1500);
    } finally {
      // 짧은 디바운스 — 같은 코드 연속 스캔 방지
      setTimeout(() => setScanning(false), 600);
    }
  }, [scanning]);

  const lowStock = items.filter((i) => typeof i.minStock === 'number' && i.minStock !== null && i.currentStock <= i.minStock).length;

  return (
    <>
      <Stack.Screen options={{ title: '자재관리' }} />
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[styles.search, { flex: 1 }]}
              placeholder="품명/코드 검색 (2글자 이상)"
              placeholderTextColor={c.placeholder}
              value={search}
              onChangeText={onSearch}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setScannerOpen(true)} style={styles.scanBtn}>
              <Text style={styles.scanIcon}>📷</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.summary}>
            총 {items.length}품목{lowStock > 0 && ` · 부족 ${lowStock}건`}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetch(search); setRefreshing(false); }} />}
        >
          {loading ? <ActivityIndicator color={COLORS.primary[500]} /> : items.length === 0 ? (
            <Text style={styles.empty}>{search ? '검색 결과가 없습니다' : '품목이 없습니다'}</Text>
          ) : items.map((it) => {
            const low = typeof it.minStock === 'number' && it.minStock !== null && it.currentStock <= it.minStock;
            return (
              <View key={it.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{it.name}</Text>
                    <Text style={styles.code}>{it.code}{it.category ? ` · ${it.category.name}` : ''}</Text>
                  </View>
                  <View style={[styles.stockBadge, low && styles.stockBadgeLow]}>
                    <Text style={[styles.stockText, low && styles.stockTextLow]}>
                      {it.currentStock}{it.unit ? ` ${it.unit}` : ''}
                    </Text>
                  </View>
                </View>
                {it.location && <Text style={styles.meta}>📍 {it.location}</Text>}
                {typeof it.minStock === 'number' && it.minStock !== null && (
                  <Text style={styles.meta}>최소 재고 {it.minStock}{it.unit ? ` ${it.unit}` : ''}</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* 바코드/QR 스캐너 */}
      <ScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={onScanned}
        scanError={scanError}
        styles={styles}
        c={c}
      />

      {/* 스캔 결과 */}
      <ScanResultModal
        item={scanResult}
        onClose={() => setScanResult(null)}
        onScanAgain={() => { setScanResult(null); setScannerOpen(true); }}
        styles={styles}
        c={c}
        isDark={isDark}
      />
    </>
  );
}

/* ───────── 바코드 스캐너 모달 ───────── */
function ScannerModal({
  visible, onClose, onScanned, scanError, styles, c,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (code: string) => void;
  scanError: string | null;
  styles: any;
  c: SemanticColors;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const lastScannedRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  if (!visible) return null;

  if (!permission) {
    return (
      <Modal visible transparent>
        <View style={styles.scannerLoading}>
          <ActivityIndicator color="#ffffff" />
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible transparent>
        <View style={styles.scannerLoading}>
          <Text style={{ color: '#ffffff', textAlign: 'center', padding: 24 }}>
            카메라 권한이 필요합니다.{'\n'}설정에서 권한을 허용해 주세요.
          </Text>
          <TouchableOpacity style={styles.scannerCloseBtn} onPress={onClose}>
            <Text style={styles.scannerCloseText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{
            barcodeTypes: ['qr', 'code128', 'code39', 'code93', 'ean13', 'ean8', 'upc_a', 'upc_e', 'pdf417', 'datamatrix', 'codabar', 'itf14'],
          }}
          onBarcodeScanned={({ data }) => {
            const now = Date.now();
            const last = lastScannedRef.current;
            // 같은 코드 1초 이내 중복 스캔 무시 (스캐너가 빠르게 여러 번 fire 함)
            if (last && last.code === data && now - last.at < 1000) return;
            lastScannedRef.current = { code: data, at: now };
            onScanned(data);
          }}
        >
          {/* 가이드 프레임 */}
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerHint}>자재 바코드 또는 QR 코드를 프레임에 맞춰주세요</Text>
            <View style={styles.scannerFrame}>
              <View style={[styles.scannerCorner, { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 }]} />
              <View style={[styles.scannerCorner, { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 }]} />
              <View style={[styles.scannerCorner, { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
              <View style={[styles.scannerCorner, { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 }]} />
            </View>
            {scanError && (
              <View style={styles.scannerError}>
                <Text style={styles.scannerErrorText}>{scanError}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.scannerCloseBtn} onPress={onClose}>
            <Text style={styles.scannerCloseText}>✕ 닫기</Text>
          </TouchableOpacity>
        </CameraView>
      </View>
    </Modal>
  );
}

/* ───────── 스캔 결과 모달 ───────── */
function ScanResultModal({
  item, onClose, onScanAgain, styles, c, isDark,
}: {
  item: InvItem | null;
  onClose: () => void;
  onScanAgain: () => void;
  styles: any;
  c: SemanticColors;
  isDark: boolean;
}) {
  if (!item) return null;
  const low = typeof item.minStock === 'number' && item.minStock !== null && item.currentStock <= item.minStock;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalOverlay, { backgroundColor: c.scrim }]}>
        <View style={[styles.scanResultCard, { backgroundColor: c.surface, borderColor: c.border, borderWidth: isDark ? 1 : 0 }]}>
          <Text style={styles.scanResultLabel}>스캔 결과</Text>
          <Text style={[styles.scanResultName, { color: c.text }]}>{item.name}</Text>
          <Text style={[styles.scanResultCode, { color: c.textMuted }]}>{item.code}</Text>
          {item.category && (
            <Text style={[styles.scanResultMeta, { color: c.textMuted }]}>분류: {item.category.name}</Text>
          )}
          {item.specification && (
            <Text style={[styles.scanResultMeta, { color: c.textMuted }]}>규격: {item.specification}</Text>
          )}
          <View style={[
            styles.scanStockBox,
            { backgroundColor: low ? (isDark ? '#3a1a1a' : '#fee2e2') : (isDark ? '#0f3a25' : '#dcfce7') },
          ]}>
            <Text style={[styles.scanStockLabel, { color: c.textMuted }]}>현재 재고</Text>
            <Text style={[
              styles.scanStockValue,
              { color: low ? '#dc2626' : (isDark ? '#86efac' : '#15803d') },
            ]}>
              {item.currentStock}{item.unit ? ` ${item.unit}` : ''}
            </Text>
            {typeof item.minStock === 'number' && item.minStock !== null && (
              <Text style={[styles.scanStockMin, { color: c.textSubtle }]}>
                최소 재고 {item.minStock}{item.unit ? ` ${item.unit}` : ''}{low ? ' · 부족' : ''}
              </Text>
            )}
          </View>
          {item.location && (
            <Text style={[styles.scanResultMeta, { color: c.textMuted, marginTop: 8 }]}>
              📍 {item.location}
            </Text>
          )}

          <View style={styles.scanResultActions}>
            <TouchableOpacity onPress={onScanAgain} style={styles.scanAgainBtn}>
              <Text style={[styles.scanAgainText, { color: c.text }]}>다시 스캔</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.scanOkBtn}>
              <Text style={styles.scanOkText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { padding: 12, gap: 6 },
  search: { backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: c.border },
  summary: { fontSize: 12, color: c.textMuted, marginLeft: 4 },
  empty: { textAlign: 'center', color: c.textSubtle, padding: 40 },
  card: { backgroundColor: c.surface, padding: 14, borderRadius: 14, marginBottom: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  name: { fontSize: 14, fontWeight: '600', color: c.text },
  code: { fontSize: 11, color: c.textSubtle, marginTop: 2 },
  stockBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: isDark ? '#0f3a25' : COLORS.primary[50] },
  stockBadgeLow: { backgroundColor: isDark ? '#3a1a1a' : '#fef2f2' },
  stockText: { fontSize: 14, fontWeight: '700', color: isDark ? '#86efac' : COLORS.primary[700] },
  stockTextLow: { color: '#dc2626' },
  meta: { fontSize: 11, color: c.textMuted, marginTop: 2 },

  /* 바코드 스캐너 */
  scanBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.primary[500],
    alignItems: 'center', justifyContent: 'center',
  },
  scanIcon: { fontSize: 22 },

  scannerLoading: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center',
  },
  scannerOverlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  scannerHint: {
    color: '#ffffff', fontSize: 13, fontWeight: '600', textAlign: 'center',
    paddingHorizontal: 20, marginBottom: 24,
  },
  scannerFrame: {
    width: 240, height: 240, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  scannerCorner: { position: 'absolute', width: 28, height: 28, borderColor: '#22c55e' },
  scannerError: {
    marginTop: 24, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(220, 38, 38, 0.85)', borderRadius: 10, maxWidth: '85%',
  },
  scannerErrorText: { color: '#ffffff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  scannerCloseBtn: {
    position: 'absolute', bottom: Platform.OS === 'ios' ? 36 : 24, alignSelf: 'center',
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  scannerCloseText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  /* 스캔 결과 */
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scanResultCard: {
    width: '100%', maxWidth: 380, padding: 20, borderRadius: 16,
  },
  scanResultLabel: { fontSize: 11, fontWeight: '700', color: COLORS.primary[500], marginBottom: 6, textTransform: 'uppercase' },
  scanResultName: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  scanResultCode: { fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 8 },
  scanResultMeta: { fontSize: 12, marginTop: 4 },
  scanStockBox: { marginTop: 12, padding: 14, borderRadius: 12, alignItems: 'center' },
  scanStockLabel: { fontSize: 11, fontWeight: '600' },
  scanStockValue: { fontSize: 28, fontWeight: '800', marginVertical: 4 },
  scanStockMin: { fontSize: 11 },
  scanResultActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  scanAgainBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.border },
  scanAgainText: { fontSize: 14, fontWeight: '600' },
  scanOkBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: COLORS.primary[500] },
  scanOkText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
