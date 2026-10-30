import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 180000,
    // One shared database: run test files one after another.
    fileParallelism: false,
    pool: 'forks',
    isolate: false,
    poolOptions: { forks: { singleFork: true } },
  },
});
