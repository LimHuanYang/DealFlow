import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
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

describe('POST /api/v1/auth/signup — default_currency from Accept-Language', () => {
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

  it('en-US → USD', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: `us.${Date.now()}@example.com`,
        password: 'CorrectHorseBatteryStaple1',
        name: 'U',
        orgName: 'U',
      },
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    expect(res.statusCode).toBe(201);
    const orgId = (res.json() as { organization: { id: string } }).organization.id;
    const [row] = await testDb.db.execute<{ default_currency: string }>(
      sql`SELECT default_currency FROM organizations WHERE id = ${orgId}`,
    );
    expect(row?.default_currency).toBe('USD');
  });

  it('ms-MY → MYR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: `my.${Date.now()}@example.com`,
        password: 'CorrectHorseBatteryStaple1',
        name: 'M',
        orgName: 'M',
      },
      headers: { 'accept-language': 'ms-MY,en-US;q=0.9' },
    });
    expect(res.statusCode).toBe(201);
    const orgId = (res.json() as { organization: { id: string } }).organization.id;
    const [row] = await testDb.db.execute<{ default_currency: string }>(
      sql`SELECT default_currency FROM organizations WHERE id = ${orgId}`,
    );
    expect(row?.default_currency).toBe('MYR');
  });

  it('missing header → USD (default)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: `nohdr.${Date.now()}@example.com`,
        password: 'CorrectHorseBatteryStaple1',
        name: 'N',
        orgName: 'N',
      },
    });
    expect(res.statusCode).toBe(201);
    const orgId = (res.json() as { organization: { id: string } }).organization.id;
    const [row] = await testDb.db.execute<{ default_currency: string }>(
      sql`SELECT default_currency FROM organizations WHERE id = ${orgId}`,
    );
    expect(row?.default_currency).toBe('USD');
  });
});
