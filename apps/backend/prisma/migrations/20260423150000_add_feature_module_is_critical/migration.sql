-- FeatureModule.isCritical — super_admin 전용 토글 여부
ALTER TABLE "feature_modules" ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;

-- 물리장비/대외노출 기능은 기본적으로 critical 로 설정
UPDATE "feature_modules" SET "is_critical" = true WHERE "name" IN ('cctv', 'parking', 'attendance');
