import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ts-node 없이 ESM/TS 직접 실행
    environment: 'node',
    globals: false,
    // unit 테스트는 DB 없이 빠르게
    // integration 테스트는 프로젝트 루트 .env의 DATABASE_URL 사용
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // 통합 테스트는 DB 트랜잭션을 공유하지 않도록 순차 실행 권장
    // (race test는 병렬 실행하되 테스트 간 데이터 격리 필요)
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/websocket/**'],
    },
  },
  resolve: {
    alias: { '@': '/src' },
  },
});
