/**
 * Department tree 유틸리티
 *
 * 순환 참조 검출은 BFS로 상위 부서 체인을 타고 올라가면서
 * deptId를 다시 만나면 cycle로 판정한다.
 */

interface DeptLookup {
  findParent: (id: string) => Promise<{ parentId: string | null } | null>;
}

/**
 * 새 parentId로 deptId의 상위 부서를 바꿀 때 순환이 생기는지 검사
 *
 * @param deptId 이동하려는 부서 ID
 * @param newParentId 새 상위 부서 ID (null이면 루트 → 항상 false)
 * @param lookup prisma 래퍼 (테스트에서 쉽게 mock 가능)
 */
export async function wouldCreateCycle(
  deptId: string,
  newParentId: string,
  lookup: DeptLookup,
  maxHops = 64,
): Promise<boolean> {
  if (deptId === newParentId) return true;

  const visited = new Set<string>([deptId]);
  let current: string | null = newParentId;
  let hops = 0;

  while (current) {
    if (visited.has(current)) return true;
    visited.add(current);

    if (++hops > maxHops) return true; // 과도한 깊이 방어

    const parent = await lookup.findParent(current);
    if (!parent) return false;
    current = parent.parentId;
  }
  return false;
}
