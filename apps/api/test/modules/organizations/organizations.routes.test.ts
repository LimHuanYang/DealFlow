import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('GET /api/v1/organizations/current', () => {
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

  it('401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/organizations/current' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the current org for an authenticated member', async () => {
    const { cookie } = await signupTestUser(app, { orgName: 'OrgRead' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { organization: { name: string; defaultCurrency: string } };
    expect(body.organization.name).toBe('OrgRead');
    expect(body.organization.defaultCurrency).toBe('USD');
  });
});

describe('PATCH /api/v1/organizations/current', () => {
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

  it('401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      payload: { defaultCurrency: 'EUR' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('updates defaultCurrency', async () => {
    const { cookie } = await signupTestUser(app, { orgName: 'OrgPatch' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      payload: { defaultCurrency: 'EUR' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { organization: { defaultCurrency: string } };
    expect(body.organization.defaultCurrency).toBe('EUR');

    // Verify persisted
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie },
    });
    expect(
      (after.json() as { organization: { defaultCurrency: string } }).organization.defaultCurrency,
    ).toBe('EUR');
  });

  it('updates name', async () => {
    const { cookie } = await signupTestUser(app, { orgName: 'BeforeRename' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      payload: { name: 'AfterRename' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { organization: { name: string } }).organization.name).toBe(
      'AfterRename',
    );
  });

  it('400 on unsupported currency code', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      payload: { defaultCurrency: 'XYZ' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('tenancy: one org cannot update another', async () => {
    // Two separate signups → two separate orgs. Each user can only see their own.
    const a = await signupTestUser(app, { orgName: 'OrgA' });
    const b = await signupTestUser(app, { orgName: 'OrgB' });

    const resA = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      payload: { defaultCurrency: 'GBP' },
      headers: { cookie: a.cookie },
    });
    expect(resA.statusCode).toBe(200);

    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie: b.cookie },
    });
    // OrgB's currency should be untouched.
    expect(
      (resB.json() as { organization: { defaultCurrency: string } }).organization.defaultCurrency,
    ).toBe('USD');
  });
});
