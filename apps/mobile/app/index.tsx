import { Redirect } from 'expo-router';

export default function Index() {
  // TODO: 인증 상태 확인 후 라우팅
  return <Redirect href="/(auth)/login" />;
}
