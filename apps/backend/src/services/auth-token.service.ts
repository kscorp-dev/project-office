/**
 * 초대 / 비밀번호 재설정 토큰 서비스
 *
 * - 토큰: 32바이트 URL-safe base64 (약 43자)
 * - 만료: invite 48시간 / reset 1시간 (기본)
 * - 단일 사용: usedAt 설정되면 재사용 불가
 * - 같은 이메일/타입으로 기존 미사용 토큰은 이전 토큰 만료(revoke) 후 새로 발급
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { Prisma, AuthTokenType, UserRole } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from './auth.service';
import { sendInviteEmail, sendPasswordResetEmail } from './system-mail.service';
import { config } from '../config';
import { logger } from '../config/logger';

const INVITE_EXPIRY_HOURS = 48;
const RESET_EXPIRY_HOURS = 1;

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ── 초대 ──

export interface CreateInviteInput {
  email: string;
  employeeId: string;
  name: string;
  role?: UserRole;
  position?: string;
  departmentId?: string;
  phone?: string;
  hireDate?: Date;
  createdById: string; // 관리자
}

export async function createInvite(
  input: CreateInviteInput,
): Promise<{ tokenId: string; token: string; expiresAt: Date }> {
  // 중복 체크
  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { employeeId: input.employeeId }] },
    select: { id: true, email: true, employeeId: true },
  });
  if (existingUser) {
    if (existingUser.email === input.email) {
      throw new AppError(409, 'EMAIL_EXISTS', '이미 가입된 이메일입니다');
    }
    throw new AppError(409, 'EMPLOYEE_ID_EXISTS', '이미 사용 중인 사번입니다');
  }

  // 기존 미사용 초대 토큰은 만료 처리
  await prisma.authToken.updateMany({
    where: { email: input.email, type: 'invite', usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 3600 * 1000);

  const payload: Prisma.InputJsonValue = {
    employeeId: input.employeeId,
    name: input.name,
    role: input.role ?? 'user',
    position: input.position ?? null,
    departmentId: input.departmentId ?? null,
    phone: input.phone ?? null,
    hireDate: input.hireDate?.toISOString() ?? null,
  };

  const record = await prisma.authToken.create({
    data: {
      token,
      type: 'invite',
      email: input.email,
      userId: null,
      invitePayload: payload,
      createdById: input.createdById,
      expiresAt,
    },
  });

  // 관리자 이름 조회 후 발송
  const inviter = await prisma.user.findUnique({
    where: { id: input.createdById },
    select: { name: true },
  });

  await sendInviteEmail({
    to: input.email,
    inviteeName: input.name,
    inviterName: inviter?.name || '관리자',
    token,
    expiresAt,
  }).catch((e) => {
    logger.warn({ err: e, email: input.email }, '[invite] email failed');
  });

  return { tokenId: record.id, token, expiresAt };
}

/** 초대 토큰 유효성 검사 + 페이로드 반환 */
export async function verifyInvite(token: string): Promise<{
  email: string;
  name: string;
  employeeId: string;
  expiresAt: Date;
}> {
  const record = await prisma.authToken.findUnique({ where: { token } });
  if (!record || record.type !== 'invite') {
    throw new AppError(404, 'INVALID_TOKEN', '유효하지 않은 초대 링크입니다');
  }
  if (record.usedAt) {
    throw new AppError(400, 'ALREADY_USED', '이미 사용된 초대 링크입니다');
  }
  if (record.expiresAt < new Date()) {
    throw new AppError(400, 'EXPIRED', '만료된 초대 링크입니다. 관리자에게 재발급을 요청하세요');
  }
  const payload = (record.invitePayload as Record<string, unknown> | null) ?? {};
  return {
    email: record.email,
    name: typeof payload.name === 'string' ? payload.name : '',
    employeeId: typeof payload.employeeId === 'string' ? payload.employeeId : '',
    expiresAt: record.expiresAt,
  };
}

/**
 * 초대 수락 — 토큰 + 비밀번호로 사용자 계정 활성화
 */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ userId: string; email: string }> {
  if (password.length < config.password.minLength || password.length > config.password.maxLength) {
    throw new AppError(
      400,
      'INVALID_PASSWORD',
      `비밀번호는 ${config.password.minLength}~${config.password.maxLength}자여야 합니다`,
    );
  }

  const record = await prisma.authToken.findUnique({ where: { token } });
  if (!record || record.type !== 'invite') {
    throw new AppError(404, 'INVALID_TOKEN', '유효하지 않은 초대 링크입니다');
  }
  if (record.usedAt) throw new AppError(400, 'ALREADY_USED', '이미 사용된 초대입니다');
  if (record.expiresAt < new Date()) throw new AppError(400, 'EXPIRED', '만료된 초대입니다');

  const payload = (record.invitePayload as Record<string, unknown> | null) ?? {};
  const hashed = await bcrypt.hash(password, config.bcrypt.saltRounds);

  // 트랜잭션: User 생성 + 토큰 usedAt 업데이트
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: record.email,
        employeeId: String(payload.employeeId ?? ''),
        name: String(payload.name ?? ''),
        password: hashed,
        role: (payload.role as UserRole) ?? 'user',
        position: typeof payload.position === 'string' ? payload.position : null,
        departmentId: typeof payload.departmentId === 'string' ? payload.departmentId : null,
        phone: typeof payload.phone === 'string' ? payload.phone : null,
        hireDate: typeof payload.hireDate === 'string' ? new Date(payload.hireDate) : null,
        status: 'active',
      },
    });
    await tx.authToken.update({
      where: { id: record.id },
      data: { usedAt: new Date(), userId: created.id },
    });
    // 초기 비번 히스토리
    await tx.passwordHistory.create({
      data: { userId: created.id, password: hashed },
    });
    return created;
  });

  logger.info({ userId: user.id, email: user.email }, '[invite] accepted');
  return { userId: user.id, email: user.email };
}

// ── 비밀번호 재설정 ──

/** 재설정 요청 — 이메일로 사용자 찾아 토큰 + 메일 발송 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, status: true },
  });

  // 보안: 존재 여부에 관계없이 동일 응답 (enum 공격 방지)
  if (!user || user.status !== 'active') {
    logger.debug({ email }, '[password-reset] user not found or inactive — silent no-op');
    return;
  }

  // 기존 미사용 재설정 토큰 만료
  await prisma.authToken.updateMany({
    where: {
      userId: user.id,
      type: 'password_reset',
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { expiresAt: new Date() },
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 3600 * 1000);

  await prisma.authToken.create({
    data: {
      token,
      type: 'password_reset',
      email,
      userId: user.id,
      createdById: user.id, // 본인 요청
      expiresAt,
    },
  });

  await sendPasswordResetEmail({
    to: email,
    userName: user.name,
    token,
    expiresAt,
  }).catch((e) => {
    logger.warn({ err: e, email }, '[password-reset] email failed');
  });
}

/** 재설정 토큰 유효성 검사 */
export async function verifyPasswordResetToken(token: string): Promise<{ userId: string; email: string }> {
  const record = await prisma.authToken.findUnique({ where: { token } });
  if (!record || record.type !== 'password_reset') {
    throw new AppError(404, 'INVALID_TOKEN', '유효하지 않은 재설정 링크입니다');
  }
  if (record.usedAt) throw new AppError(400, 'ALREADY_USED', '이미 사용된 링크입니다');
  if (record.expiresAt < new Date()) throw new AppError(400, 'EXPIRED', '만료된 링크입니다. 재요청해주세요');
  if (!record.userId) throw new AppError(500, 'INVALID_STATE', '사용자 정보가 없습니다');
  return { userId: record.userId, email: record.email };
}

/**
 * 비밀번호 재설정 완료
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<{ userId: string }> {
  if (
    newPassword.length < config.password.minLength ||
    newPassword.length > config.password.maxLength
  ) {
    throw new AppError(
      400,
      'INVALID_PASSWORD',
      `비밀번호는 ${config.password.minLength}~${config.password.maxLength}자여야 합니다`,
    );
  }

  const record = await prisma.authToken.findUnique({ where: { token } });
  if (!record || record.type !== 'password_reset') {
    throw new AppError(404, 'INVALID_TOKEN', '유효하지 않은 재설정 링크입니다');
  }
  if (record.usedAt) throw new AppError(400, 'ALREADY_USED', '이미 사용된 링크입니다');
  if (record.expiresAt < new Date()) throw new AppError(400, 'EXPIRED', '만료된 링크입니다');
  if (!record.userId) throw new AppError(500, 'INVALID_STATE', '사용자 정보가 없습니다');

  // 최근 5개 비번 재사용 금지 (기존 정책과 통일)
  const histories = await prisma.passwordHistory.findMany({
    where: { userId: record.userId },
    orderBy: { createdAt: 'desc' },
    take: config.password.historyCount,
  });
  for (const h of histories) {
    if (await bcrypt.compare(newPassword, h.password)) {
      throw new AppError(400, 'PASSWORD_REUSED', '최근에 사용한 비밀번호는 재사용할 수 없습니다');
    }
  }

  const hashed = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId! },
      data: {
        password: hashed,
        loginFailCount: 0,
        lockedUntil: null,
      },
    });
    await tx.passwordHistory.create({
      data: { userId: record.userId!, password: hashed },
    });
    await tx.authToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // 진행 중인 리프레시 토큰 모두 revoke (재설정 후 전역 로그아웃)
    await tx.refreshToken.updateMany({
      where: { userId: record.userId!, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  logger.info({ userId: record.userId }, '[password-reset] completed');
  return { userId: record.userId };
}

// ── 정리 유틸 (옵션) ──

/** 만료된 토큰 삭제 (cron에서 호출 가능) */
export async function purgeExpiredTokens(): Promise<number> {
  const result = await prisma.authToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
        { usedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
      ],
    },
  });
  return result.count;
}
