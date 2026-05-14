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

export async function runMigrations(db: Database, folder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
