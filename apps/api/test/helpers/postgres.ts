import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, type Database, runMigrations } from '@dealflow/db';

/**
 * Connection string for an *admin* role that can CREATE/DROP databases.
 * Defaults to the local `postgres` superuser. Override in CI by setting
 * `DEALFLOW_TEST_ADMIN_URL`.
 */
const ADMIN_URL =
  process.env.DEALFLOW_TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

/**
 * Credentials that the application uses against the per-test database.
 * Must already exist as a role on the Postgres server.
 * Defaults match the local dev convention: user `dealflow`, password `dealflow`.
 */
const APP_USER = process.env.DEALFLOW_TEST_USER ?? 'dealflow';
const APP_PASSWORD = process.env.DEALFLOW_TEST_PASSWORD ?? 'dealflow';
const PG_HOST = process.env.DEALFLOW_TEST_HOST ?? 'localhost';
const PG_PORT = process.env.DEALFLOW_TEST_PORT ?? '5432';

export interface TestDatabase {
  db: Database;
  url: string;
  /** Generated database name, e.g. `dealflow_test_a1b2c3...` */
  dbName: string;
  /** Closes the connection pool AND drops the per-test database. */
  stop: () => Promise<void>;
}

/**
 * Create a fresh, disposable Postgres database for one test file.
 *
 * Approach (native Postgres, no Docker):
 *  1. Connect as the admin role (`postgres` by default).
 *  2. `CREATE DATABASE dealflow_test_<random>` owned by the app role.
 *  3. Return a Drizzle handle pointed at the new DB.
 *  4. On `stop()`, close the pool and `DROP DATABASE` (terminating any leftover
 *     connections first).
 *
 * Use in `beforeAll`; call `stop()` in `afterAll`. Sub-Plan 2 will extend this
 * helper to also run Drizzle migrations before returning the db handle.
 */
export async function startTestPostgres(): Promise<TestDatabase> {
  const dbName = `dealflow_test_${randomBytes(8).toString('hex')}`;

  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    // CREATE DATABASE can't be parameterized — interpolating is safe here because
    // dbName is generated server-side from randomBytes, not user input.
    await admin.unsafe(`CREATE DATABASE "${dbName}" OWNER "${APP_USER}"`);
  } finally {
    await admin.end();
  }

  const url = `postgres://${APP_USER}:${APP_PASSWORD}@${PG_HOST}:${PG_PORT}/${dbName}`;
  const conn = createDb(url);

  // Apply migrations so every test file starts against a fully-built schema.
  await runMigrations(conn.db);

  return {
    db: conn.db,
    url,
    dbName,
    stop: async () => {
      // Release our pool first so DROP DATABASE doesn't error on active sessions.
      await conn.end();

      const cleanup = postgres(ADMIN_URL, { max: 1 });
      try {
        // Defensively kick any stragglers (Vitest workers, leaked clients).
        await cleanup.unsafe(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
        );
        await cleanup.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
