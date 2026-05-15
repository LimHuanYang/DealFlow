import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('POST /api/v1/auth/logout', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('204 + clears cookie', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const setCookie = res.cookies.find((c) => c.name === 'dealflow_session');
    // clearCookie sets value to '' with an expiry in the past.
    expect(setCookie?.value).toBe('');
  });

  it('204 even when not authenticated (idempotent)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    expect(res.statusCode).toBe(204);
  });
});
