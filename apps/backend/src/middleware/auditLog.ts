import { Request } from 'express';
import prisma from '../config/prisma';
import { AuditAction, RiskLevel } from '@prisma/client';

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
        ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip,
        userAgent: req.headers['user-agent'] ?? null,
        deviceId: req.user?.deviceId ?? null,
        details: (details ?? undefined) as any,
        result,
        riskLevel,
      },
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}
