import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma';
import { config } from '../config';
import { JwtPayload } from '../middleware/authenticate';

interface RegisterData {
  employeeId: string;
  email: string;
  name: string;
  password: string;
  departmentId?: string;
  position?: string;
  phone?: string;
}

interface LoginData {
  employeeId: string;
  password: string;
  deviceInfo?: {
    deviceId: string;
    deviceType: string;
    deviceName: string;
    pushToken?: string;
  };
}

export class AuthService {
  /**
   * 회원가입
   */
  async register(data: RegisterData) {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { employeeId: data.employeeId },
          { email: data.email },
        ],
      },
    });

    if (existing) {
      const field = existing.employeeId === data.employeeId ? '사번' : '이메일';
      throw new AppError(409, 'DUPLICATE', `이미 등록된 ${field}입니다`);
    }

    if (data.departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!dept) throw new AppError(400, 'INVALID_DEPARTMENT', '존재하지 않는 부서입니다');
    }

    const hashedPassword = await bcrypt.hash(data.password, config.bcrypt.saltRounds);

    const user = await prisma.user.create({
      data: {
        employeeId: data.employeeId,
        email: data.email,
        name: data.name,
        password: hashedPassword,
        departmentId: data.departmentId,
        position: data.position,
        phone: data.phone,
        status: 'pending',
      },
      select: {
        id: true,
        employeeId: true,
        email: true,
        name: true,
        role: true,
        status: true,
        position: true,
        departmentId: true,
        createdAt: true,
      },
    });

    // 비밀번호 이력 저장
    await prisma.passwordHistory.create({
      data: { userId: user.id, password: hashedPassword },
    });

    return user;
  }

  /**
   * 로그인
   */
  async login(data: LoginData) {
    const user = await prisma.user.findUnique({
      where: { employeeId: data.employeeId },
      include: {
        department: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '사번 또는 비밀번호가 올바르지 않습니다');
    }

    // 계정 잠금 확인
    if (user.status === 'locked') {
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const remainMin = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        throw new AppError(423, 'ACCOUNT_LOCKED', `계정이 잠겼습니다. ${remainMin}분 후 재시도해주세요`);
      }
      // 잠금 시간 경과 → 해제
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'active', loginFailCount: 0, lockedUntil: null },
      });
    }

    if (user.status === 'inactive') {
      throw new AppError(403, 'ACCOUNT_INACTIVE', '비활성화된 계정입니다. 관리자에게 문의하세요');
    }

    if (user.status === 'pending') {
      throw new AppError(403, 'ACCOUNT_PENDING', '승인 대기중인 계정입니다');
    }

    // 비밀번호 검증
    const isValid = await bcrypt.compare(data.password, user.password);
    if (!isValid) {
      const failCount = user.loginFailCount + 1;
      const updates: Record<string, unknown> = { loginFailCount: failCount };

      if (failCount >= config.password.maxLoginAttempts) {
        updates.status = 'locked';
        updates.lockedUntil = new Date(Date.now() + config.password.lockDurationMinutes * 60000);
      }

      await prisma.user.update({ where: { id: user.id }, data: updates });
      throw new AppError(401, 'INVALID_CREDENTIALS', '사번 또는 비밀번호가 올바르지 않습니다');
    }

    // 로그인 성공 → 실패 카운트 초기화
    await prisma.user.update({
      where: { id: user.id },
      data: { loginFailCount: 0, lastLoginAt: new Date(), lockedUntil: null },
    });

    // 디바이스 등록/업데이트
    if (data.deviceInfo) {
      await prisma.userDevice.upsert({
        where: {
          userId_deviceId: {
            userId: user.id,
            deviceId: data.deviceInfo.deviceId,
          },
        },
        update: {
          deviceName: data.deviceInfo.deviceName,
          pushToken: data.deviceInfo.pushToken,
          lastUsedAt: new Date(),
          isActive: true,
        },
        create: {
          userId: user.id,
          deviceId: data.deviceInfo.deviceId,
          deviceType: data.deviceInfo.deviceType,
          deviceName: data.deviceInfo.deviceName,
          pushToken: data.deviceInfo.pushToken,
        },
      });
    }

    // 토큰 발급
    const tokenFamily = uuidv4();
    const { accessToken, refreshToken } = this.generateTokens(user.id, user.role, user.departmentId, data.deviceInfo?.deviceId);

    // Refresh Token DB 저장
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        family: tokenFamily,
        deviceId: data.deviceInfo?.deviceId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const { password: _, loginFailCount: __, ...safeUser } = user;

    return {
      accessToken,
      refreshToken,
      user: safeUser,
    };
  }

  /**
   * 토큰 갱신 (Refresh Token Rotation)
   */
  async refreshToken(token: string) {
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!storedToken || storedToken.revokedAt) {
      // 이미 사용된 토큰 → token family 전체 무효화 (탈취 감지)
      if (storedToken) {
        await prisma.refreshToken.updateMany({
          where: { family: storedToken.family },
          data: { revokedAt: new Date() },
        });
      }
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', '유효하지 않은 리프레시 토큰입니다');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', '리프레시 토큰이 만료되었습니다');
    }

    if (storedToken.user.status !== 'active') {
      throw new AppError(403, 'ACCOUNT_INACTIVE', '비활성화된 계정입니다');
    }

    // 기존 토큰 무효화
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // 새 토큰 발급
    const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(
      storedToken.userId,
      storedToken.user.role,
      storedToken.user.departmentId,
      storedToken.deviceId,
    );

    await prisma.refreshToken.create({
      data: {
        userId: storedToken.userId,
        token: newRefreshToken,
        family: storedToken.family,
        deviceId: storedToken.deviceId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * 로그아웃
   */
  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { userId, token: refreshToken },
        data: { revokedAt: new Date() },
      });
    } else {
      // 모든 세션 로그아웃
      await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  /**
   * 비밀번호 변경
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다');

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) throw new AppError(401, 'INVALID_PASSWORD', '현재 비밀번호가 올바르지 않습니다');

    // 최근 비밀번호와 비교
    const history = await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: config.password.historyCount,
    });

    for (const prev of history) {
      if (await bcrypt.compare(newPassword, prev.password)) {
        throw new AppError(400, 'PASSWORD_REUSED', `최근 ${config.password.historyCount}개와 동일한 비밀번호는 사용할 수 없습니다`);
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordHistory.create({
        data: { userId, password: hashedPassword },
      }),
    ]);
  }

  private generateTokens(userId: string, role: string, deptId?: string | null, deviceId?: string | null) {
    const payload: JwtPayload = {
      sub: userId,
      role,
      deptId: deptId ?? undefined,
      deviceId: deviceId ?? undefined,
    };

    const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiresIn as any,
    });

    const refreshToken = jwt.sign({ sub: userId, type: 'refresh' }, config.jwt.refreshSecret, {
      expiresIn: config.jwt.refreshExpiresIn as any,
    });

    return { accessToken, refreshToken };
  }
}

// 커스텀 에러 클래스
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const authService = new AuthService();
