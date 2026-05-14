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

export function createDb(connectionString: string): DealflowConnection {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
  });
  const db = drizzle(client, { schema: schemaModule });
  return {
    db,
    client,
    end: () => client.end(),
  };
}

export * as schema from './schema/index.js';
