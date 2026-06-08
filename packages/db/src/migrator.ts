import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';
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

interface JournalEntry {
  idx: number;
  tag: string;
}

/**
 * Apply all generated migrations into a single target schema, for the
 * **schema-per-test** harness (Supabase, no local Postgres).
 *
 * Why this exists instead of drizzle's `migrate()`:
 *   The generated SQL hard-codes foreign-key targets as `"public"."<table>"`
 *   (drizzle's default schema qualifier). Under a per-test schema those FKs
 *   would bind to the shared `public` copy of the tables, so rows inserted into
 *   the test schema fail the FK check. We read each migration file, rewrite the
 *   literal `"public".` qualifier to the test schema, and run every statement
 *   with `search_path` pointed at that schema (then `public`,`extensions` so
 *   Supabase's `citext`/`pgcrypto` stay resolvable). Unqualified `CREATE TABLE`
 *   etc. already land in the first schema on the path.
 *
 * This never touches the real `public` data — it only writes into `schema`.
 */
export async function applyMigrationsToSchema(
  client: Sql,
  schema: string,
  folder = MIGRATIONS_FOLDER,
): Promise<void> {
  const journalRaw = await readFile(path.join(folder, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(journalRaw) as { entries: JournalEntry[] };
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  // Quote-safe identifier for embedding in SQL (e.g. SET search_path / FK refs).
  const quoted = `"${schema.replace(/"/g, '""')}"`;

  for (const entry of entries) {
    const sqlText = await readFile(path.join(folder, `${entry.tag}.sql`), 'utf8');
    // Retarget FK references (and any other `"public".` qualifier) at the test schema.
    const retargeted = sqlText.replaceAll('"public".', `${quoted}.`);
    const statements = retargeted
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      // search_path must be re-asserted per statement: some migrations run inside
      // their own `DO $$ ... $$` blocks, but unqualified CREATE TABLE relies on it.
      await client.unsafe(`SET search_path TO ${quoted}, public, extensions; ${statement}`);
    }
  }
}
