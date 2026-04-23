-- SystemSetting.minRole — 이 설정을 편집할 수 있는 최소 역할 (admin / super_admin)
ALTER TABLE "system_settings" ADD COLUMN "min_role" TEXT NOT NULL DEFAULT 'admin';

-- 보안·시스템 민감 키는 super_admin 으로 승격
UPDATE "system_settings"
SET "min_role" = 'super_admin'
WHERE "key" IN (
  'session_timeout',
  'password_min_length',
  'max_login_attempts',
  'maintenance_mode'
);
