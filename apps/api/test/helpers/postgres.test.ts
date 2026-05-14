import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { startTestPostgres, type TestDatabase } from './postgres.js';

describe('Postgres test helper (native, per-file disposable DB)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
  }, 30_000); // native Postgres + CREATE DATABASE is fast (~1-2s); generous margin for CI

  afterAll(async () => {
    await testDb.stop();
  });

  it('returns a working Database that can execute SELECT 1', async () => {
    const result = await testDb.db.execute(sql`SELECT 1 AS n`);
    expect(result[0]).toMatchObject({ n: 1 });
  });

  it('has the auth tables created by migrations', async () => {
    const result = await testDb.db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'invitations',
        'oauth_accounts',
        'org_members',
        'organizations',
        'sessions',
        'users',
      ]),
    );
  });
});
