/**
 * 결재 위임 관리 화면.
 *
 * - 내가 만든 위임 (outgoing) — 활성/비활성 표시 + 취소 버튼
 * - 내가 받은 위임 (incoming) — 활성만 표시 (정보용)
 * - 새 위임 생성 — 모달에서 대상 선택 + 기간 + 사유
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
  KeyboardAvoidingView, Platform, FlatList,
} from 'react-native';
import { Stack } from 'expo-router';
import { COLORS, type SemanticColors } from '../../src/constants/theme';
import { useTheme } from '../../src/hooks/useTheme';
import api from '../../src/services/api';

interface UserBrief {
  id: string;
  name: string;
  position?: string | null;
  employeeId?: string | null;
  department?: { name: string | null } | null;
}

interface Delegation {
  id: string;
  fromUserId: string;
  toUserId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  isActive: boolean;
  createdAt: string;
  toUser?: UserBrief;
  fromUser?: UserBrief;
}

export default function DelegationScreen() {
  const { c, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);
  const [outgoing, setOutgoing] = useState<Delegation[]>([]);
  const [incoming, setIncoming] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get('/approvals/delegations');
      setOutgoing(res.data?.data?.outgoing ?? []);
      setIncoming(res.data?.data?.incoming ?? []);
    } catch (err: any) {
      console.warn('delegation fetch failed', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCancel = (dlg: Delegation) => {
    Alert.alert(
      '위임 취소',
      `${dlg.toUser?.name ?? '대상자'}님에게 보낸 위임을 취소하시겠습니까?`,
      [
        { text: '아니오', style: 'cancel' },
        {
          text: '취소',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/approvals/delegations/${dlg.id}`);
              fetchAll();
            } catch (err: any) {
              Alert.alert('실패', err?.response?.data?.error?.message ?? '취소에 실패했습니다');
            }
          },
        },
      ],
    );
  };

  const isActiveNow = (dlg: Delegation): boolean => {
    if (!dlg.isActive) return false;
    const now = Date.now();
    return new Date(dlg.startDate).getTime() <= now && now <= new Date(dlg.endDate).getTime();
  };

  return (
    <>
      <Stack.Screen options={{ title: '결재 위임' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchAll(); }} />}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.primary[500]} style={{ marginTop: 40 }} />
        ) : (
          <>
            <Text style={styles.hint}>
              휴가/출장 시 본인 결재를 다른 사용자가 대신 처리할 수 있도록 위임할 수 있습니다.
              위임된 결재는 코멘트에 [대결] 표기가 자동으로 붙습니다.
            </Text>

            {/* Outgoing */}
            <Text style={styles.sectionTitle}>내가 만든 위임 ({outgoing.length})</Text>
            {outgoing.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>아직 만든 위임이 없습니다</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {outgoing.map((dlg) => {
                  const active = isActiveNow(dlg);
                  return (
                    <View key={dlg.id} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.userName}>
                            {dlg.toUser?.name ?? '?'}
                            {dlg.toUser?.position && (
                              <Text style={styles.position}> · {dlg.toUser.position}</Text>
                            )}
                          </Text>
                          <View style={[styles.badge, active ? styles.badgeActive : styles.badgeInactive]}>
                            <Text style={[styles.badgeText, active ? styles.badgeTextActive : styles.badgeTextInactive]}>
                              {active ? '활성' : (dlg.isActive ? '예정' : '비활성')}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.meta}>
                          {fmtDate(dlg.startDate)} ~ {fmtDate(dlg.endDate)}
                        </Text>
                        {dlg.reason && <Text style={styles.reason}>"{dlg.reason}"</Text>}
                      </View>
                      {dlg.isActive && (
                        <TouchableOpacity onPress={() => handleCancel(dlg)} style={styles.cancelBtn}>
                          <Text style={styles.cancelBtnText}>취소</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Incoming */}
            <Text style={styles.sectionTitle}>내가 받은 활성 위임 ({incoming.length})</Text>
            {incoming.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>받은 위임이 없습니다</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {incoming.map((dlg) => (
                  <View key={dlg.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName}>
                        {dlg.fromUser?.name ?? '?'}
                        {dlg.fromUser?.position && (
                          <Text style={styles.position}> · {dlg.fromUser.position}</Text>
                        )}
                      </Text>
                      <Text style={styles.meta}>
                        {fmtDate(dlg.startDate)} ~ {fmtDate(dlg.endDate)}
                      </Text>
                      {dlg.reason && <Text style={styles.reason}>"{dlg.reason}"</Text>}
                    </View>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity onPress={() => setShowCreate(true)} style={styles.addBtn}>
              <Text style={styles.addBtnText}>＋ 새 위임 만들기</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <CreateDelegationModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); fetchAll(); }}
        styles={styles}
        c={c}
      />
    </>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function pad(n: number) { return String(n).padStart(2, '0'); }

/* ───────── 위임 생성 모달 ───────── */
function CreateDelegationModal({
  visible, onClose, onCreated, styles, c,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  styles: any;
  c: SemanticColors;
}) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [selected, setSelected] = useState<UserBrief | null>(null);
  // 기본: 오늘 + 1시간 ~ +7일
  const [startISO, setStartISO] = useState(() => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16));
  const [endISO, setEndISO] = useState(() => new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 16));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 검색 (간단 debounce 없음 — 짧은 user search)
  useEffect(() => {
    if (!visible || !search.trim() || search.trim().length < 1) {
      setUsers([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/users?search=${encodeURIComponent(search.trim())}&limit=10`);
        const list = res.data?.data?.users ?? res.data?.data ?? [];
        setUsers(Array.isArray(list) ? list : []);
      } catch { setUsers([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, visible]);

  const handleSubmit = async () => {
    if (!selected) {
      Alert.alert('알림', '위임받을 사용자를 선택하세요');
      return;
    }
    const start = new Date(startISO);
    const end = new Date(endISO);
    if (end <= start) {
      Alert.alert('알림', '종료일은 시작일보다 이후여야 합니다');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/approvals/delegations', {
        toUserId: selected.id,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        reason: reason.trim() || undefined,
      });
      // reset
      setSelected(null); setSearch(''); setReason('');
      onCreated();
    } catch (err: any) {
      Alert.alert('실패', err?.response?.data?.error?.message ?? '위임 생성 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalContainer}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>새 위임 만들기</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ fontSize: 22, color: c.textSubtle }}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 500 }} contentContainerStyle={{ padding: 20 }}>
            <Text style={styles.inputLabel}>위임받을 사용자 *</Text>
            {selected ? (
              <View style={styles.selectedUser}>
                <Text style={styles.selectedUserName}>
                  {selected.name} {selected.position ? `· ${selected.position}` : ''}
                </Text>
                <TouchableOpacity onPress={() => { setSelected(null); setSearch(''); }}>
                  <Text style={{ fontSize: 18, color: c.textSubtle }}>×</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="이름 또는 사번으로 검색"
                  placeholderTextColor={c.placeholder}
                  style={styles.input}
                />
                {users.length > 0 && (
                  <View style={[styles.card, { marginTop: 8 }]}>
                    <FlatList
                      data={users}
                      keyExtractor={(u) => u.id}
                      keyboardShouldPersistTaps="handled"
                      scrollEnabled={false}
                      renderItem={({ item }) => (
                        <TouchableOpacity onPress={() => { setSelected(item); setSearch(''); setUsers([]); }} style={styles.userPickRow}>
                          <Text style={styles.userPickName}>
                            {item.name} {item.position ? `· ${item.position}` : ''}
                          </Text>
                          <Text style={styles.userPickMeta}>
                            {item.employeeId ?? ''} {item.department?.name ? `· ${item.department.name}` : ''}
                          </Text>
                        </TouchableOpacity>
                      )}
                    />
                  </View>
                )}
              </>
            )}

            <Text style={styles.inputLabel}>시작 시각 *</Text>
            <TextInput
              value={startISO}
              onChangeText={setStartISO}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={c.placeholder}
              style={styles.input}
            />

            <Text style={styles.inputLabel}>종료 시각 *</Text>
            <TextInput
              value={endISO}
              onChangeText={setEndISO}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={c.placeholder}
              style={styles.input}
            />

            <Text style={styles.inputLabel}>사유 (선택)</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="예: 5/1~5/3 휴가"
              placeholderTextColor={c.placeholder}
              style={[styles.input, { height: 70, textAlignVertical: 'top' }]}
              multiline
              maxLength={500}
            />

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={submitting || !selected}
              style={[styles.submitBtn, (submitting || !selected) && styles.submitBtnDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.submitBtnText}>위임 만들기</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ───────── 스타일 ───────── */
const makeStyles = (c: SemanticColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  hint: { fontSize: 12, color: c.textMuted, lineHeight: 18, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.text, marginTop: 14, marginBottom: 8, textTransform: 'uppercase' },

  emptyBox: { padding: 24, alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, borderWidth: isDark ? 1 : 0, borderColor: c.border },
  emptyText: { color: c.textSubtle, fontSize: 13 },

  card: { backgroundColor: c.surface, borderRadius: 14, overflow: 'hidden', borderWidth: isDark ? 1 : 0, borderColor: c.border },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 10 },
  userName: { fontSize: 14, fontWeight: '600', color: c.text },
  position: { color: c.textSubtle, fontWeight: '400' },
  meta: { fontSize: 11, color: c.textMuted, marginTop: 4 },
  reason: { fontSize: 12, color: c.textMuted, marginTop: 4, fontStyle: 'italic' },

  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeActive: { backgroundColor: isDark ? '#0f3a25' : '#dcfce7' },
  badgeInactive: { backgroundColor: isDark ? '#252a30' : '#e5e7eb' },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextActive: { color: isDark ? '#86efac' : '#15803d' },
  badgeTextInactive: { color: c.textMuted },

  cancelBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: isDark ? '#3a1a1a' : '#fee2e2' },
  cancelBtnText: { fontSize: 12, fontWeight: '600', color: '#dc2626' },

  addBtn: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: COLORS.primary[500], alignItems: 'center' },
  addBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  /* 모달 */
  modalOverlay: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 24 : 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: c.divider },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  inputLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.surfaceAlt },
  selectedUser: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, backgroundColor: c.surfaceAlt, borderRadius: 10 },
  selectedUserName: { fontSize: 14, fontWeight: '600', color: c.text },
  userPickRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  userPickName: { fontSize: 14, fontWeight: '600', color: c.text },
  userPickMeta: { fontSize: 11, color: c.textSubtle, marginTop: 2 },
  submitBtn: { marginTop: 20, backgroundColor: COLORS.primary[500], borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { backgroundColor: c.border },
  submitBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
});
