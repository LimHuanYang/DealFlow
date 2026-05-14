import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, type Database } from '@dealflow/db';

export interface TestDatabase {
  db: Database;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Start a fresh Postgres container for one test file.
 * Use in `beforeAll`; call `stop()` in `afterAll`.
 *
 * Sub-Plan 2 will extend this helper to also run Drizzle migrations
 * before returning the db handle.
 */
export async function startTestPostgres(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('dealflow_test')
    .withUsername('dealflow')
    .withPassword('dealflow')
    .start();

  const url = container.getConnectionUri();
  const db = createDb(url);

  return {
    db,
    url,
    stop: async () => {
      await container.stop();
    },
  };
}
