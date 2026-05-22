import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Companies routes', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    const auth = await signupTestUser(app);
    cookie = auth.cookie;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('POST creates and GET fetches', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Acme', domain: 'acme.com' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ company: { id: string; name: string } }>();
    expect(body.company.name).toBe('Acme');

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${body.company.id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ company: { name: string } }>().company.name).toBe('Acme');
  });

  it('GET list returns items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/companies?limit=50',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ items: unknown[] }>().items)).toBe(true);
  });

  it('POST rejects missing name with 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { domain: 'no-name.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('PATCH updates partial fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Patch Me' },
    });
    const id = created.json<{ company: { id: string } }>().company.id;
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
      payload: { industry: 'SaaS' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ company: { industry: string } }>().company.industry).toBe('SaaS');
  });

  it('DELETE returns 204 then GET 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'DelMe' },
    });
    const id = created.json<{ company: { id: string } }>().company.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(404);
  });

  it('401 when not authed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/companies' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Companies customFields', () => {
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

  it('PATCH /companies/:id merges valid customFields', async () => {
    const { cookie } = await signupTestUser(app);
    // Create a definition
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'company', name: 'Industry Vertical', type: 'text' },
    });
    const fieldId = def.json().id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Acme' },
    });
    const companyId = created.json().company.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${companyId}`,
      headers: { cookie },
      payload: { customFields: { [fieldId]: 'FinTech' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().company.customFields).toEqual({ [fieldId]: 'FinTech' });
  });

  it('PATCH rejects unknown custom field key with 400', async () => {
    const { cookie } = await signupTestUser(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Acme' },
    });
    const id = created.json().company.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie },
      payload: { customFields: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /companies/:id returns customFields', async () => {
    const { cookie } = await signupTestUser(app);
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'company', name: 'Notes', type: 'text' },
    });
    const fieldId = def.json().id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'Acme', customFields: { [fieldId]: 'hello' } },
    });
    const id = created.json().company.id;
    const got = await app.inject({ method: 'GET', url: `/api/v1/companies/${id}`, headers: { cookie } });
    expect(got.json().company.customFields).toEqual({ [fieldId]: 'hello' });
  });
});
