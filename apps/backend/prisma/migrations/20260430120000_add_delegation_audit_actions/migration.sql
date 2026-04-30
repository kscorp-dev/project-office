-- 위임 audit actions 추가 (audit 10B H2)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'delegation_create';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'delegation_cancel';
