import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schemaModule from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schemaModule>;

export interface DealflowConnection {
  /** Drizzle handle for all queries. */
  db: Database;
  /** Underlying postgres-js client (use `end()` for clean shutdown). */
  client: Sql;
  /** Close the connection pool. Always call before dropping the DB. */
  end(): Promise<void>;
}

export interface CreateDbOptions {
  /** Max pool size. Defaults to 10. */
  max?: number;
  /**
   * Postgres `search_path` for every connection in the pool. When set, the
   * value is passed verbatim as the connection's `search_path` (e.g.
   * `"test_ab12cd34",public,extensions`). Used by the schema-per-test harness
   * so each test file resolves its own schema first while keeping Supabase's
   * `citext`/`pgcrypto` types (in `extensions`) resolvable.
   */
  searchPath?: string;
}

export function createDb(connectionString: string, opts: CreateDbOptions = {}): DealflowConnection {
  const client = postgres(connectionString, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    ...(opts.searchPath ? { connection: { search_path: opts.searchPath } } : {}),
  });
  const db = drizzle(client, { schema: schemaModule });
  return {
    db,
    client,
    end: () => client.end(),
  };
}

export * as schema from './schema/index.js';

export { runMigrations, MIGRATIONS_FOLDER } from './migrator.js';
