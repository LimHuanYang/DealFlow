import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, type Database, runMigrations } from '@dealflow/db';

/**
 * Base connection string for the test database. The project is Supabase-only,
 * so this points at the Supabase **session pooler** (the `...pooler.supabase.com:5432`
 * host) which supports the DDL we need (`CREATE SCHEMA`, `search_path`).
 *
 * Resolution order: an explicit `DEALFLOW_TEST_DATABASE_URL` override, otherwise
 * the app's `DATABASE_URL` (loaded from `apps/api/.env` by the Vitest global
 * setup). Throws early with a clear message if neither is set.
 */
function resolveBaseUrl(): string {
  const url = process.env.DEALFLOW_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'Test database URL is not set. Expected DEALFLOW_TEST_DATABASE_URL or DATABASE_URL ' +
        '(loaded from apps/api/.env by test/global-setup.ts). Cannot run integration tests.',
    );
  }
  return url;
}

export interface TestDatabase {
  db: Database;
  url: string;
  /**
   * Name of the per-test Postgres schema, e.g. `test_a1b2c3d4`. (Historically
   * this field held a database name; the schema-per-test harness reuses the
   * field for the schema so the ~50 existing callers don't change.)
   */
  dbName: string;
  /** Closes the connection pool AND drops the per-test schema. */
  stop: () => Promise<void>;
}

/**
 * Create a fresh, isolated Postgres **schema** for one test file on Supabase.
 *
 * The project has no local Postgres or Docker — every test file runs against
 * the live Supabase database, isolated by its own schema:
 *  1. Connect a 1-conn admin client and `CREATE SCHEMA "test_<random>"`.
 *  2. Return a Drizzle handle whose `search_path` resolves that schema first,
 *     then `public,extensions` (so Supabase's `citext`/`pgcrypto` types stay
 *     resolvable).
 *  3. Run migrations with the journal + tables targeted at the test schema.
 *  4. On `stop()`, close the pool and `DROP SCHEMA ... CASCADE`.
 *
 * Use in `beforeAll`; call `stop()` in `afterAll`.
 */
export async function startTestPostgres(): Promise<TestDatabase> {
  const baseUrl = resolveBaseUrl();
  const schema = `test_${randomBytes(4).toString('hex')}`;

  // 1. Create the schema as a short-lived admin connection, then release it.
  const admin = postgres(baseUrl, { max: 1 });
  try {
    // CREATE SCHEMA can't be parameterized — interpolating is safe because the
    // name is generated server-side from randomBytes, not from user input.
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }

  // 2. App handle: resolve the test schema first; keep public + extensions so
  //    Supabase's citext/pgcrypto types and gen_random_uuid() stay resolvable.
  const conn = createDb(baseUrl, {
    max: 4,
    searchPath: `"${schema}",public,extensions`,
  });

  // 3. Apply migrations so every test file starts against a fully-built schema.
  //    Targeting migrationsSchema lands the drizzle journal AND (via search_path)
  //    the created tables inside the test schema.
  await runMigrations(conn.db, { migrationsSchema: schema });

  return {
    db: conn.db,
    url: baseUrl,
    dbName: schema,
    stop: async () => {
      // Release our pool first, then drop the schema from a fresh admin client.
      await conn.end();

      const cleanup = postgres(baseUrl, { max: 1 });
      try {
        await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
