import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolves to `packages/db/migrations/` regardless of where the caller lives.
 * Works from the package root, from apps/api, and from compiled output.
 */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'migrations');

export interface RunMigrationsOptions {
  /** Folder containing the generated SQL migrations. Defaults to MIGRATIONS_FOLDER. */
  folder?: string;
  /** Schema the drizzle journal table lives in. Passed through to drizzle's `migrate()`. */
  migrationsSchema?: string;
  /** Name of the drizzle journal table. Passed through to drizzle's `migrate()`. */
  migrationsTable?: string;
}

/**
 * Apply Drizzle migrations. Back-compatible: pass a folder string (legacy) or an
 * options object. `migrationsSchema`/`migrationsTable` route the journal (and,
 * combined with a connection `search_path`, the created objects) into a target
 * schema — used by the schema-per-test harness.
 */
export async function runMigrations(
  db: Database,
  folderOrOpts: string | RunMigrationsOptions = MIGRATIONS_FOLDER,
): Promise<void> {
  const opts: RunMigrationsOptions =
    typeof folderOrOpts === 'string' ? { folder: folderOrOpts } : folderOrOpts;

  await migrate(db, {
    migrationsFolder: opts.folder ?? MIGRATIONS_FOLDER,
    ...(opts.migrationsSchema ? { migrationsSchema: opts.migrationsSchema } : {}),
    ...(opts.migrationsTable ? { migrationsTable: opts.migrationsTable } : {}),
  });
}
