/**
 * 페이지네이션 파라미터 파싱 유틸리티
 *
 * 표준 쿼리 파라미터: ?page=1&limit=20
 * - page는 1부터 시작 (사용자 친화적)
 * - 기본값과 최대값 clamp로 악의적 요청 방어
 */

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Options {
  defaultLimit?: number;
  maxLimit?: number;
}

/**
 * Express req.query에서 page/limit을 안전하게 파싱한다.
 */
export function parsePagination(
  query: Record<string, unknown>,
  options: Options = {},
): PaginationParams {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;

  const rawPage = typeof query.page === 'string' ? parseInt(query.page, 10) : NaN;
  const rawLimit = typeof query.limit === 'string' ? parseInt(query.limit, 10) : NaN;

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const limitCandidate = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : defaultLimit;
  const limit = Math.min(limitCandidate, maxLimit);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * PaginationParams + 총 건수로 표준 meta 생성.
 */
export function buildMeta(params: PaginationParams, total: number): PaginationMeta {
  return {
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
}
