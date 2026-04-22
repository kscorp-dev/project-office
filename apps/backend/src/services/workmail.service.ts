/**
 * AWS WorkMail 관리 API 래퍼
 *
 * 조직 내 메일박스(사용자) CRUD를 담당한다.
 * 실제 메일 송수신은 IMAP/SMTP로 별도 구현 (mail.service.ts 예정).
 *
 * 필수 환경변수:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   WORKMAIL_ORG_ID, WORKMAIL_DOMAIN
 */
import {
  WorkMailClient,
  ListUsersCommand,
  DescribeUserCommand,
  CreateUserCommand,
  DeleteUserCommand,
  RegisterToWorkMailCommand,
  DeregisterFromWorkMailCommand,
  ResetPasswordCommand,
  UpdateMailboxQuotaCommand,
  GetMailboxDetailsCommand,
  DescribeOrganizationCommand,
  UpdateUserCommand,
  type User as WorkMailUser,
} from '@aws-sdk/client-workmail';

export interface MailboxSummary {
  userId: string;
  email: string | null;
  name: string;
  displayName: string;
  state: string;                  // ENABLED, DISABLED, DELETED
  enabledDate?: Date;
  role: string;                   // USER, RESOURCE, SYSTEM_USER
}

export interface MailboxDetail extends MailboxSummary {
  quotaMB: number;
  usedMB: number;
  usagePercent: number;
  provisionedDate?: Date;
  hiddenFromGAL: boolean;
}

export class WorkMailService {
  private client: WorkMailClient;
  private orgId: string;
  private domain: string;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const orgId = process.env.WORKMAIL_ORG_ID;
    const domain = process.env.WORKMAIL_DOMAIN;

    if (!orgId) throw new Error('WORKMAIL_ORG_ID is required');
    if (!domain) throw new Error('WORKMAIL_DOMAIN is required');

    this.orgId = orgId;
    this.domain = domain;
    this.client = new WorkMailClient({ region });
  }

  /** 조직 기본 정보 (연결 테스트 용) */
  async describeOrganization() {
    const res = await this.client.send(new DescribeOrganizationCommand({
      OrganizationId: this.orgId,
    }));
    return {
      organizationId: res.OrganizationId,
      alias: res.Alias,
      state: res.State,
      defaultMailDomain: res.DefaultMailDomain,
      directoryId: res.DirectoryId,
      directoryType: res.DirectoryType,
      completedDate: res.CompletedDate,
      arn: res.ARN,
    };
  }

  /** 전체 사용자 목록 */
  async listUsers(options: { includeDeleted?: boolean } = {}): Promise<MailboxSummary[]> {
    const users: WorkMailUser[] = [];
    let nextToken: string | undefined;

    do {
      const res = await this.client.send(new ListUsersCommand({
        OrganizationId: this.orgId,
        MaxResults: 100,
        NextToken: nextToken,
      }));
      if (res.Users) users.push(...res.Users);
      nextToken = res.NextToken;
    } while (nextToken);

    return users
      .filter((u) => options.includeDeleted || u.State !== 'DELETED')
      .map(this.toSummary);
  }

  /** 이메일로 사용자 검색 (WorkMail은 직접 검색 API가 없어 list 후 필터) */
  async findByEmail(email: string): Promise<MailboxSummary | null> {
    const all = await this.listUsers({ includeDeleted: true });
    return all.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  }

  /** 사용자 상세 (쿼터/사용량 포함) */
  async describeUser(userId: string): Promise<MailboxDetail> {
    const [user, mailbox] = await Promise.all([
      this.client.send(new DescribeUserCommand({
        OrganizationId: this.orgId,
        UserId: userId,
      })),
      this.client.send(new GetMailboxDetailsCommand({
        OrganizationId: this.orgId,
        UserId: userId,
      })).catch(() => ({ MailboxQuota: 0, MailboxSize: 0 })),
    ]);

    const quotaMB = mailbox.MailboxQuota ?? 0;
    const usedMB = mailbox.MailboxSize ?? 0;

    return {
      userId: user.UserId!,
      email: user.Email ?? null,
      name: user.Name ?? '',
      displayName: user.DisplayName ?? '',
      state: user.State ?? 'UNKNOWN',
      role: user.UserRole ?? 'USER',
      enabledDate: user.EnabledDate,
      provisionedDate: user.MailboxProvisionedDate,
      hiddenFromGAL: user.HiddenFromGlobalAddressList ?? false,
      quotaMB,
      usedMB,
      usagePercent: quotaMB > 0 ? Math.round((usedMB / quotaMB) * 1000) / 10 : 0,
    };
  }

  /**
   * 메일박스 생성 = CreateUser + RegisterToWorkMail
   *
   * WorkMail은 2단계 프로세스:
   *  1) 사용자 레코드 생성 (아직 메일 안 받음)
   *  2) 메일박스에 등록 → 이 시점에 email 활성화
   */
  async createMailbox(params: {
    username: string;
    password: string;
    displayName: string;
    firstName?: string;
    lastName?: string;
    hiddenFromGAL?: boolean;
  }): Promise<{ userId: string; email: string }> {
    if (!/^[a-z0-9._-]{1,64}$/.test(params.username)) {
      throw new Error('username은 소문자 영숫자/./_/- 만 허용 (최대 64자)');
    }
    if (params.password.length < 8) {
      throw new Error('비밀번호는 8자 이상이어야 합니다');
    }

    // 1. 사용자 생성
    const createRes = await this.client.send(new CreateUserCommand({
      OrganizationId: this.orgId,
      Name: params.username,
      DisplayName: params.displayName,
      Password: params.password,
      FirstName: params.firstName,
      LastName: params.lastName,
      HiddenFromGlobalAddressList: params.hiddenFromGAL ?? false,
    }));

    const userId = createRes.UserId!;
    const email = `${params.username}@${this.domain}`;

    // 2. 메일박스 활성화
    await this.client.send(new RegisterToWorkMailCommand({
      OrganizationId: this.orgId,
      EntityId: userId,
      Email: email,
    }));

    return { userId, email };
  }

  /** 비밀번호 재설정 */
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new Error('비밀번호는 8자 이상이어야 합니다');
    }
    await this.client.send(new ResetPasswordCommand({
      OrganizationId: this.orgId,
      UserId: userId,
      Password: newPassword,
    }));
  }

  /** 쿼터 변경 (MB 단위) */
  async updateQuota(userId: string, quotaMB: number): Promise<void> {
    if (quotaMB < 100 || quotaMB > 50 * 1024) {
      throw new Error('쿼터는 100MB ~ 50GB 범위');
    }
    await this.client.send(new UpdateMailboxQuotaCommand({
      OrganizationId: this.orgId,
      UserId: userId,
      MailboxQuota: quotaMB,
    }));
  }

  /** 표시명 변경 */
  async updateDisplayName(userId: string, params: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    hiddenFromGAL?: boolean;
  }): Promise<void> {
    await this.client.send(new UpdateUserCommand({
      OrganizationId: this.orgId,
      UserId: userId,
      DisplayName: params.displayName,
      FirstName: params.firstName,
      LastName: params.lastName,
      HiddenFromGlobalAddressList: params.hiddenFromGAL,
    }));
  }

  /** 메일박스 비활성화 (메일 수신 중단, 데이터는 유지) */
  async deregister(userId: string): Promise<void> {
    await this.client.send(new DeregisterFromWorkMailCommand({
      OrganizationId: this.orgId,
      EntityId: userId,
    }));
  }

  /** 메일박스 완전 삭제 (복구 불가) */
  async deleteMailbox(userId: string): Promise<void> {
    await this.client.send(new DeleteUserCommand({
      OrganizationId: this.orgId,
      UserId: userId,
    }));
  }

  private toSummary(u: WorkMailUser): MailboxSummary {
    return {
      userId: u.Id!,
      email: u.Email ?? null,
      name: u.Name ?? '',
      displayName: u.DisplayName ?? '',
      state: u.State ?? 'UNKNOWN',
      role: u.UserRole ?? 'USER',
      enabledDate: u.EnabledDate,
    };
  }
}

// 싱글톤 (lazy initialize — 환경변수 없이 import는 허용, 호출 시점에 검증)
let _instance: WorkMailService | null = null;
export function getWorkMailService(): WorkMailService {
  if (!_instance) _instance = new WorkMailService();
  return _instance;
}
