import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 기능 모듈 시드
  const modules = [
    { name: 'auth', displayName: '인증/조직관리', sortOrder: 1 },
    { name: 'approval', displayName: '전자결재', sortOrder: 2 },
    { name: 'messenger', displayName: '메신저', sortOrder: 3 },
    { name: 'cctv', displayName: 'CCTV 모니터링', sortOrder: 4 },
    { name: 'attendance', displayName: '근태관리', sortOrder: 5 },
    { name: 'calendar', displayName: '캘린더', sortOrder: 6 },
    { name: 'board', displayName: '게시판', sortOrder: 7 },
    { name: 'task_order', displayName: '작업지시서', sortOrder: 8 },
    { name: 'inventory', displayName: '재고관리', sortOrder: 9 },
    { name: 'meeting', displayName: '화상회의', sortOrder: 10 },
    { name: 'document', displayName: '문서관리', sortOrder: 11 },
    { name: 'admin', displayName: '관리자콘솔', sortOrder: 12 },
  ];

  for (const mod of modules) {
    await prisma.featureModule.upsert({
      where: { name: mod.name },
      update: {},
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
  const hashedPassword = await bcrypt.hash('Admin@1234', 12);

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

  console.log('Seed completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
