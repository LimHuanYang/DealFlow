import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** apps/api/.env — holds DATABASE_URL (Supabase session pooler) for tests. */
const ENV_PATH = path.resolve(__dirname, '..', '.env');

/**
 * Vitest global setup. Runs once in the main process before any test file:
 *  1. Loads `apps/api/.env` so DATABASE_URL is available (the project is
 *     Supabase-only; tests connect to the live DB).
 *  2. Sweeps leftover `test_%` schemas from crashed prior runs so the database
 *     doesn't accumulate orphans.
 *
 * NOTE: env vars are also loaded per-worker via `test/setup-env.ts`
 * (`setupFiles`), because forked workers don't inherit env mutations made here.
 */
export default async function setup(): Promise<void> {
  loadDotenv({ path: ENV_PATH });

  const baseUrl = process.env.DEALFLOW_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error(
      `Test database URL is not set. Expected DEALFLOW_TEST_DATABASE_URL or DATABASE_URL ` +
        `(looked for ${ENV_PATH}). Cannot run integration tests.`,
    );
  }

  // Drop any orphaned test schemas left by crashed runs. `_` is a LIKE wildcard,
  // so it's escaped to match a literal underscore.
  const sql = postgres(baseUrl, { max: 1 });
  try {
    const orphans = await sql<{ schema_name: string }[]>`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE 'test\_%' ESCAPE '\'
    `;
    for (const { schema_name } of orphans) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema_name}" CASCADE`);
    }
    if (orphans.length > 0) {
      console.log(`[global-setup] dropped ${orphans.length} orphaned test schema(s)`);
    }
  } finally {
    await sql.end();
  }
}
