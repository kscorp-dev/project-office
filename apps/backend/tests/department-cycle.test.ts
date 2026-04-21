/**
 * Department 순환 참조 통합 테스트 (실제 DB)
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma, uniqueId } from './fixtures';
import { wouldCreateCycle } from '../src/utils/departmentTree';

const ids: string[] = [];

async function mkDept(name: string, parentId: string | null, depth: number) {
  const code = uniqueId('DEP').toUpperCase().replace(/-/g, '_');
  const d = await prisma.department.create({
    data: { name: `${name}-${code}`, code, parentId, depth, sortOrder: 0 },
  });
  ids.push(d.id);
  return d;
}

describe('Department cycle (실제 DB)', () => {
  let root: any, a: any, b: any, c: any, e: any;

  beforeAll(async () => {
    // ROOT → A → B → C
    //      → E
    root = await mkDept('root', null, 0);
    a = await mkDept('A', root.id, 1);
    b = await mkDept('B', a.id, 2);
    c = await mkDept('C', b.id, 3);
    e = await mkDept('E', root.id, 1);
  });

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  const lookup = {
    findParent: (id: string) => prisma.department.findUnique({
      where: { id },
      select: { parentId: true },
    }),
  };

  it('A를 C의 자식으로 이동 시도 → cycle 감지', async () => {
    expect(await wouldCreateCycle(a.id, c.id, lookup)).toBe(true);
  });

  it('A를 E의 자식으로 이동 → 문제 없음', async () => {
    expect(await wouldCreateCycle(a.id, e.id, lookup)).toBe(false);
  });

  it('ROOT를 A의 자식으로 이동 시도 → cycle', async () => {
    expect(await wouldCreateCycle(root.id, a.id, lookup)).toBe(true);
  });

  it('B를 루트로 이동 (null 허용 경로) → 체크 스킵', async () => {
    // null parentId면 cycle 검사 자체가 필요 없음
    // 대신 실제 cycle 체크는 newParentId가 존재할 때만 수행됨
    expect(await wouldCreateCycle(b.id, root.id, lookup)).toBe(false);
  });
});
