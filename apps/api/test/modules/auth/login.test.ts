import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('POST /api/v1/auth/login', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    await signupTestUser(app, {
      email: 'login@example.com',
      password: 'CorrectHorseBatteryStaple1',
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('200 + session cookie on correct credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login@example.com', password: 'CorrectHorseBatteryStaple1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 'dealflow_session')).toBeDefined();
  });

  it('401 on wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'login@example.com', password: 'NopeNopeNopeNope' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('401 on unknown email (same code as wrong password — no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'anything-12chars' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });
});
