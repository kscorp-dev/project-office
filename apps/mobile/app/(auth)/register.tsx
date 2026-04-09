import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, Alert, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { api } from '../../src/services/api';
import { COLORS } from '../../src/constants/theme';

export default function RegisterScreen() {
  const [form, setForm] = useState({
    employeeId: '',
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    position: '',
    phone: '',
  });
  const [loading, setLoading] = useState(false);

  const update = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleRegister = async () => {
    if (!form.employeeId || !form.name || !form.email || !form.password) {
      Alert.alert('알림', '필수 항목을 모두 입력해주세요.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      Alert.alert('알림', '비밀번호가 일치하지 않습니다.');
      return;
    }
    if (form.password.length < 8) {
      Alert.alert('알림', '비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/register', {
        employeeId: form.employeeId,
        name: form.name,
        email: form.email,
        password: form.password,
        position: form.position || undefined,
        phone: form.phone || undefined,
      });
      Alert.alert('회원가입 완료', '관리자 승인 후 로그인할 수 있습니다.', [
        { text: '확인', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('오류', err.response?.data?.error?.message || '회원가입에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backText}>{'< 뒤로'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>회원가입</Text>
          <Text style={styles.subtitle}>Project Office 계정을 생성합니다</Text>
        </View>

        <View style={styles.card}>
          {[
            { key: 'employeeId', label: '사번 *', placeholder: 'EMP001' },
            { key: 'name', label: '이름 *', placeholder: '홍길동' },
            { key: 'email', label: '이메일 *', placeholder: 'user@kscorp.kr', keyboard: 'email-address' as const },
            { key: 'password', label: '비밀번호 *', placeholder: '8자 이상', secure: true },
            { key: 'confirmPassword', label: '비밀번호 확인 *', placeholder: '비밀번호 재입력', secure: true },
            { key: 'position', label: '직급', placeholder: '선택사항' },
            { key: 'phone', label: '연락처', placeholder: '010-0000-0000', keyboard: 'phone-pad' as const },
          ].map((field) => (
            <View key={field.key} style={styles.inputWrap}>
              <Text style={styles.label}>{field.label}</Text>
              <TextInput
                style={styles.input}
                placeholder={field.placeholder}
                placeholderTextColor={COLORS.gray[400]}
                value={(form as any)[field.key]}
                onChangeText={(t) => update(field.key, t)}
                secureTextEntry={field.secure}
                keyboardType={field.keyboard || 'default'}
                autoCapitalize="none"
              />
            </View>
          ))}

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>{loading ? '처리 중...' : '회원가입'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, padding: 24 },
  header: { marginTop: 48, marginBottom: 24 },
  backText: { fontSize: 15, color: COLORS.primary[600], fontWeight: '600', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.gray[800] },
  subtitle: { fontSize: 14, color: COLORS.gray[500], marginTop: 4 },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  inputWrap: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.gray[600], marginBottom: 6 },
  input: {
    backgroundColor: COLORS.gray[50],
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: COLORS.gray[800],
    borderWidth: 1,
    borderColor: COLORS.gray[200],
  },
  btn: {
    backgroundColor: COLORS.primary[500],
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
