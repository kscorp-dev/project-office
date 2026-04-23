import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 기능 모듈 시드 (task_orders 복수형으로 통일)
  // isCritical=true → 물리장비/대외노출 모듈. super_admin만 on/off 가능
  const modules = [
    { name: 'auth',        displayName: '인증/조직관리', sortOrder: 1,  isCritical: false },
    { name: 'approval',    displayName: '전자결재',      sortOrder: 2,  isCritical: false },
    { name: 'messenger',   displayName: '메신저',        sortOrder: 3,  isCritical: false },
    { name: 'cctv',        displayName: 'CCTV 모니터링', sortOrder: 4,  isCritical: true  },
    { name: 'attendance',  displayName: '근무관리',      sortOrder: 5,  isCritical: true  },
    { name: 'calendar',    displayName: '캘린더',        sortOrder: 6,  isCritical: false },
    { name: 'board',       displayName: '게시판',        sortOrder: 7,  isCritical: false },
    { name: 'task_orders', displayName: '작업지시서',    sortOrder: 8,  isCritical: false },
    { name: 'inventory',   displayName: '재고관리',      sortOrder: 9,  isCritical: false },
    { name: 'meeting',     displayName: '화상회의',      sortOrder: 10, isCritical: false },
    { name: 'document',    displayName: '문서관리',      sortOrder: 11, isCritical: false },
    { name: 'parking',     displayName: 'AI 주차 추적',  sortOrder: 12, isCritical: true  },
    { name: 'admin',       displayName: '관리자콘솔',    sortOrder: 13, isCritical: false },
  ];

  // 과거 잘못 시드된 단수형 'task_order' 제거
  await prisma.featureModule.deleteMany({ where: { name: 'task_order' } });

  for (const mod of modules) {
    await prisma.featureModule.upsert({
      where: { name: mod.name },
      // 재실행 시 isCritical 정책 변경 반영 (displayName/sortOrder는 기존값 유지)
      update: { isCritical: mod.isCritical },
      create: mod,
    });
  }

  // 루트 부서 생성
  const rootDept = await prisma.department.upsert({
    where: { code: 'ROOT' },
    update: {},
    create: {
      name: '회사',
      code: 'ROOT',
      depth: 0,
      sortOrder: 0,
    },
  });

  // 기본 부서 생성
  const depts = [
    { name: '경영지원팀', code: 'MGMT', sortOrder: 1 },
    { name: '개발팀', code: 'DEV', sortOrder: 2 },
    { name: '디자인팀', code: 'DESIGN', sortOrder: 3 },
    { name: '생산팀', code: 'PROD', sortOrder: 4 },
    { name: '영업팀', code: 'SALES', sortOrder: 5 },
  ];

  for (const dept of depts) {
    await prisma.department.upsert({
      where: { code: dept.code },
      update: {},
      create: {
        ...dept,
        parentId: rootDept.id,
        depth: 1,
      },
    });
  }

  // 슈퍼관리자 계정
  // SEED_ADMIN_PASSWORD 환경변수 우선, 없으면 개발용 기본값 (프로덕션 seed에서는 반드시 설정)
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    console.warn('[seed] ⚠️  프로덕션 환경에서 SEED_ADMIN_PASSWORD가 설정되지 않아 기본값 사용 — 즉시 변경 필요');
  }
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { employeeId: 'admin' },
    update: {},
    create: {
      employeeId: 'admin',
      email: 'admin@kscorp.com',
      name: '시스템관리자',
      password: hashedPassword,
      role: UserRole.super_admin,
      status: 'active',
      position: '관리자',
    },
  });

  // 결재 양식 시드
  const templates = [
    { name: '업무 기안', code: 'DRAFT', category: '기안', sortOrder: 1 },
    { name: '지출 결의서', code: 'EXPENSE', category: '지출', sortOrder: 2 },
    { name: '휴가 신청서', code: 'VACATION', category: '휴가', sortOrder: 3 },
    { name: '출장 신청서', code: 'TRIP', category: '출장', sortOrder: 4 },
    { name: '구매 요청서', code: 'PURCHASE', category: '구매', sortOrder: 5 },
    { name: '업무 보고서', code: 'REPORT', category: '보고', sortOrder: 6 },
    { name: '회의록', code: 'MINUTES', category: '회의록', sortOrder: 7 },
    { name: '자유 양식', code: 'FREE', category: '자유양식', sortOrder: 8 },
  ];

  for (const tmpl of templates) {
    await prisma.approvalTemplate.upsert({
      where: { code: tmpl.code },
      update: {},
      create: tmpl,
    });
  }

  // 게시판 시드 — Board.name @unique 제약 사용 (이전에는 id에 name을 넣어
  // 매 실행마다 새로 생성되는 버그가 있었음)
  const boards = [
    { name: '공지사항', type: 'notice', sortOrder: 1 },
    { name: '자유게시판', type: 'general', sortOrder: 2 },
    { name: '질문/답변', type: 'general', sortOrder: 3 },
  ];

  for (const board of boards) {
    await prisma.board.upsert({
      where: { name: board.name },
      update: {},
      create: board,
    });
  }

  // 캘린더 기본 카테고리 (전역, ownerId=null, isDefault=true)
  const defaultCategories = [
    { name: '회의',   color: '#3b82f6', sortOrder: 1 }, // blue
    { name: '개인',   color: '#22c55e', sortOrder: 2 }, // green
    { name: '휴가',   color: '#f59e0b', sortOrder: 3 }, // amber
    { name: '출장',   color: '#8b5cf6', sortOrder: 4 }, // violet
    { name: '마감',   color: '#ef4444', sortOrder: 5 }, // red
    { name: '기타',   color: '#6b7280', sortOrder: 6 }, // gray
  ];

  for (const cat of defaultCategories) {
    const existing = await prisma.calendarCategory.findFirst({
      where: { ownerId: null, name: cat.name },
    });
    if (!existing) {
      await prisma.calendarCategory.create({
        data: { ...cat, ownerId: null, isDefault: true },
      });
    }
  }

  // 테스트 사용자 추가
  const testUsers = [
    { employeeId: 'user01', email: 'user01@kscorp.com', name: '김철수', role: UserRole.user, position: '사원', deptCode: 'DEV' },
    { employeeId: 'user02', email: 'user02@kscorp.com', name: '이영희', role: UserRole.user, position: '대리', deptCode: 'DESIGN' },
    { employeeId: 'user03', email: 'user03@kscorp.com', name: '박민수', role: UserRole.dept_admin, position: '팀장', deptCode: 'PROD' },
  ];

  for (const u of testUsers) {
    const dept = await prisma.department.findUnique({ where: { code: u.deptCode } });
    await prisma.user.upsert({
      where: { employeeId: u.employeeId },
      update: {},
      create: {
        employeeId: u.employeeId,
        email: u.email,
        name: u.name,
        password: hashedPassword,
        role: u.role,
        status: 'active',
        position: u.position,
        departmentId: dept?.id,
      },
    });
  }

  // 근무 스케줄
  await prisma.workSchedule.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', name: '기본 근무', startTime: '09:00', endTime: '18:00', isDefault: true },
  });

  console.log('Seed completed');
  console.log('');
  console.log('=== 테스트 계정 ===');
  console.log('관리자: admin / Admin@1234');
  console.log('일반: user01 / Admin@1234 (김철수/개발팀)');
  console.log('일반: user02 / Admin@1234 (이영희/디자인팀)');
  console.log('팀장: user03 / Admin@1234 (박민수/생산팀)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
