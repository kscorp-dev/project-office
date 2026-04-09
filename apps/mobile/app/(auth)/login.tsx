import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, Alert, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/auth';
import { COLORS } from '../../src/constants/theme';

export default function LoginScreen() {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    if (!employeeId || !password) {
      Alert.alert('알림', '사번과 비밀번호를 입력해주세요.');
      return;
    }
    try {
      await login(employeeId, password);
      router.replace('/(tabs)/dashboard');
    } catch (e: any) {
      Alert.alert('로그인 실패', e.message || '다시 시도해주세요.');
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
        {/* 로고 */}
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>P</Text>
          </View>
          <Text style={styles.appName}>Project Office</Text>
          <Text style={styles.subtitle}>업무 통합 플랫폼</Text>
        </View>

        {/* 입력 폼 */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>로그인</Text>

          <View style={styles.inputWrap}>
            <Text style={styles.label}>사번</Text>
            <TextInput
              style={styles.input}
              placeholder="사번을 입력하세요"
              placeholderTextColor={COLORS.gray[400]}
              value={employeeId}
              onChangeText={(t) => { setEmployeeId(t); clearError(); }}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputWrap}>
            <Text style={styles.label}>비밀번호</Text>
            <TextInput
              style={styles.input}
              placeholder="비밀번호를 입력하세요"
              placeholderTextColor={COLORS.gray[400]}
              value={password}
              onChangeText={(t) => { setPassword(t); clearError(); }}
              secureTextEntry
            />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.loginBtn, isLoading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={styles.loginBtnText}>
              {isLoading ? '로그인 중...' : '로그인'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => router.push('/(auth)/register')}
          >
            <Text style={styles.registerText}>
              계정이 없으신가요? <Text style={styles.registerBold}>회원가입</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: COLORS.primary[500],
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.gray[800],
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray[500],
    marginTop: 4,
  },
  formCard: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.gray[800],
    marginBottom: 20,
  },
  inputWrap: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray[600],
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.gray[50],
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.gray[800],
    borderWidth: 1,
    borderColor: COLORS.gray[200],
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
  },
  loginBtn: {
    backgroundColor: COLORS.primary[500],
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '700',
  },
  registerLink: {
    alignItems: 'center',
  },
  registerText: {
    fontSize: 13,
    color: COLORS.gray[500],
  },
  registerBold: {
    color: COLORS.primary[600],
    fontWeight: '600',
  },
});
