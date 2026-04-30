/**
 * iOS APNs 환경(`aps-environment` entitlement)을 빌드 프로파일별로 분기.
 *
 * 동작:
 *   - process.env.EXPO_PUBLIC_APS_ENV 가 "production" 이면 production
 *   - 그 외(미설정 / "development") 는 development
 *
 * 기본 app.json 의 `ios.entitlements["aps-environment"]` 를 동적으로 덮어쓴다.
 * eas.json 의 build.<profile>.env.EXPO_PUBLIC_APS_ENV 로 제어:
 *   - development      → development (개발 빌드 — APNs sandbox)
 *   - preview/production → production (TestFlight / App Store / 외부 배포)
 *
 * 주의:
 *   - 잘못된 entitlement 로 빌드된 앱은 푸시가 silent fail 한다.
 *   - production 빌드를 development 토큰으로 보내거나 그 반대도 모두 fail.
 *   - EAS Build 환경에선 process.env 가 빌드 시작 시점에 주입된다.
 */
const { withEntitlementsPlist } = require('@expo/config-plugins');

const withApsEnvironment = (config) => {
  return withEntitlementsPlist(config, (cfg) => {
    const apsEnv = process.env.EXPO_PUBLIC_APS_ENV === 'production'
      ? 'production'
      : 'development';
    cfg.modResults['aps-environment'] = apsEnv;
    return cfg;
  });
};

module.exports = withApsEnvironment;
