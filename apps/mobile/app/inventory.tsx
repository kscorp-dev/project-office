import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../src/constants/theme';
import api from '../src/services/api';

interface InvItem {
  id: string;
  itemCode: string;
  name: string;
  category?: { id: string; name: string } | null;
  currentStock: number;
  minStock?: number | null;
  unit?: string;
  location?: string | null;
}

export default function InventoryScreen() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  const lowStock = items.filter((i) => typeof i.minStock === 'number' && i.minStock !== null && i.currentStock <= i.minStock).length;

  return (
    <>
      <Stack.Screen options={{ title: '자재관리' }} />
      <View style={styles.container}>
        <View style={styles.header}>
          <TextInput
            style={styles.search}
            placeholder="품명/코드 검색 (2글자 이상)"
            placeholderTextColor={COLORS.gray[400]}
            value={search}
            onChangeText={onSearch}
            autoCapitalize="none"
          />
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
                    <Text style={styles.code}>{it.itemCode}{it.category ? ` · ${it.category.name}` : ''}</Text>
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
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { padding: 12, gap: 6 },
  search: { backgroundColor: COLORS.white, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: COLORS.gray[200] },
  summary: { fontSize: 12, color: COLORS.gray[500], marginLeft: 4 },
  empty: { textAlign: 'center', color: COLORS.gray[400], padding: 40 },
  card: { backgroundColor: COLORS.white, padding: 14, borderRadius: 14, marginBottom: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  name: { fontSize: 14, fontWeight: '600', color: COLORS.gray[800] },
  code: { fontSize: 11, color: COLORS.gray[400], marginTop: 2 },
  stockBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: COLORS.primary[50] },
  stockBadgeLow: { backgroundColor: '#fef2f2' },
  stockText: { fontSize: 14, fontWeight: '700', color: COLORS.primary[700] },
  stockTextLow: { color: '#dc2626' },
  meta: { fontSize: 11, color: COLORS.gray[500], marginTop: 2 },
});
