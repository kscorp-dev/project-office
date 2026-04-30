import { Request } from 'express';
import prisma from '../config/prisma';
import { AuditAction, RiskLevel } from '@prisma/client';
import { logger } from '../config/logger';

interface AuditLogParams {
  req: Request;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  result?: 'success' | 'failure';
  riskLevel?: RiskLevel;
}

export async function createAuditLog({
  req,
  action,
  resourceType,
  resourceId,
  details,
  result = 'success',
  riskLevel = 'low',
}: AuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id ?? null,
        action,
        resourceType,
        resourceId,
        // req.ip 만 사용 (audit 운영 H6) — express trust proxy 가 처리.
        // headers['x-forwarded-for'] 직접 read 는 spoofing 가능 (프록시 없을 때 client 임의 보냄)
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        deviceId: req.user?.deviceId ?? null,
        details: (details ?? undefined) as any,
        result,
        riskLevel,
      },
    });
  } catch (err) {
    // 감사 실패는 보안 이벤트 — structured log + alert 우선순위
    logger.error({ err, action, resourceType, resourceId }, '[audit-log] CRITICAL: 감사 로그 저장 실패');
  }
}
