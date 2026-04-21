import prisma from '../config/prisma';
import { AppError } from './auth.service';

/**
 * (userId, type, date) 조합으로 PostgreSQL advisory lock 키를 생성
 */
export function advisoryLockKey(userId: string, type: string, yyyymmdd: string): bigint {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  const src = `${userId}|${type}|${yyyymmdd}`;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  const low = (h1 >>> 0).toString(16).padStart(8, '0');
  const high = (h2 >>> 0).toString(16).padStart(8, '0');
  return BigInt(`0x${high}${low}`) & 0x7fffffffffffffffn;
}

interface CheckInput {
  userId: string;
  type: 'check_in' | 'check_out';
  latitude?: number;
  longitude?: number;
  note?: string;
  ipAddress?: string;
  deviceType?: string;
}

/**
 * 출퇴근 기록 — advisory lock으로 동시 요청 race 제거
 * 중복 기록 시 AppError('ALREADY_CHECKED', 400)
 */
export async function recordAttendance(input: CheckInput) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyymmdd = today.toISOString().slice(0, 10);

  return prisma.$transaction(async (tx) => {
    const key = advisoryLockKey(input.userId, input.type, yyyymmdd);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`;

    const existing = await tx.attendance.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        checkTime: { gte: today, lt: tomorrow },
      },
    });
    if (existing) {
      throw new AppError(
        400,
        'ALREADY_CHECKED',
        `이미 ${input.type === 'check_in' ? '출근' : '퇴근'} 처리되었습니다`,
      );
    }

    return tx.attendance.create({
      data: {
        userId: input.userId,
        type: input.type,
        checkTime: new Date(),
        latitude: input.latitude,
        longitude: input.longitude,
        ipAddress: input.ipAddress,
        deviceType: input.deviceType,
        note: input.note,
      },
    });
  });
}
