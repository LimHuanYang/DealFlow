import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { startTestPostgres, type TestDatabase } from './postgres.js';

describe('testcontainers Postgres helper', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
  }, 180_000); // testcontainers + Postgres init on Windows/WSL 2 can take 60-90s on first run

  afterAll(async () => {
    await testDb.stop();
  });

  it('returns a working Database that can execute SELECT 1', async () => {
    const result = await testDb.db.execute(sql`SELECT 1 AS n`);
    expect(result[0]).toMatchObject({ n: 1 });
  });
});
