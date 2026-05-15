import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';

describe('POST /api/v1/auth/signup', () => {
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

  it('201 + session cookie on valid signup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'alice@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'Alice',
        orgName: 'Acme',
      },
    });
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === 'dealflow_session');
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    const body = res.json() as { user: { email: string }; organization: { name: string } };
    expect(body.user.email).toBe('alice@example.com');
    expect(body.organization.name).toBe('Acme');
  });

  it('400 on missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'b@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('409 on duplicate email', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'dup@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'D',
        orgName: 'D',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'dup@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'D2',
        orgName: 'D2',
      },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('POST /api/v1/auth/signup (self-host mode)', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db, envOverrides: { DEPLOYMENT_MODE: 'self-host' } });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('first signup ok; second blocked', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'admin@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'A',
        orgName: 'A',
      },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'other@example.com',
        password: 'CorrectHorseBatteryStaple1',
        name: 'O',
        orgName: 'O',
      },
    });
    expect(second.statusCode).toBe(403);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      'SELF_HOST_ALREADY_INITIALIZED',
    );
  });
});
