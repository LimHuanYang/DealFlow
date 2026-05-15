import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000, // beforeAll/afterAll spin up disposable Postgres DBs + run migrations
    // Run test files sequentially in a single fork. We CREATE/DROP a fresh
    // Postgres database per test file; running many files in parallel
    // exhausts Postgres's default max_connections under contention.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
