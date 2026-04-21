import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from './departmentTree';

/**
 * 가짜 트리:
 *
 *  ROOT → A → B → C
 *              └→ D
 *       → E
 *
 * parent 매핑:
 *   A: ROOT, B: A, C: B, D: B, E: ROOT, ROOT: null
 */
function makeLookup(map: Record<string, string | null>) {
  return {
    findParent: async (id: string) =>
      map[id] !== undefined ? { parentId: map[id] } : null,
  };
}

const tree = makeLookup({
  ROOT: null,
  A: 'ROOT',
  B: 'A',
  C: 'B',
  D: 'B',
  E: 'ROOT',
});

describe('wouldCreateCycle', () => {
  it('자기 자신을 parent로 지정 → cycle', async () => {
    expect(await wouldCreateCycle('A', 'A', tree)).toBe(true);
  });

  it('자기 자손을 parent로 지정 → cycle (A를 C의 자식으로 이동)', async () => {
    // newParent=C → C의 상위 체인: C→B→A→ROOT. A가 체인에 등장 → cycle
    expect(await wouldCreateCycle('A', 'C', tree)).toBe(true);
  });

  it('자기 자손을 parent로 (2단계 자손)', async () => {
    expect(await wouldCreateCycle('A', 'D', tree)).toBe(true);
  });

  it('형제 부서로 이동 → 정상 (cycle 없음)', async () => {
    // A를 E의 자식으로: A → E → ROOT, A는 체인에 없음
    expect(await wouldCreateCycle('A', 'E', tree)).toBe(false);
  });

  it('ROOT를 자식 부서 아래로 이동 시도 → cycle', async () => {
    expect(await wouldCreateCycle('ROOT', 'A', tree)).toBe(true);
  });

  it('루트로 이동 (newParent=ROOT) → cycle 없음 (B를 ROOT 바로 아래로)', async () => {
    expect(await wouldCreateCycle('B', 'ROOT', tree)).toBe(false);
  });

  it('존재하지 않는 parent → cycle 없음 (업데이트는 FK 위반으로 따로 실패)', async () => {
    expect(await wouldCreateCycle('A', 'NONEXISTENT', tree)).toBe(false);
  });

  it('maxHops 초과 — 무한 루프 방어', async () => {
    // 오염된 데이터: X → Y → X (비정상 상태)
    const broken = makeLookup({ X: 'Y', Y: 'X' });
    expect(await wouldCreateCycle('NEW', 'X', broken, 10)).toBe(true);
  });

  it('부모가 null(루트)인 체인 끝까지 탐색', async () => {
    expect(await wouldCreateCycle('D', 'E', tree)).toBe(false);
  });
});
