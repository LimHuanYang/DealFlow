import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Contacts routes', () => {
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

  it('POST creates with first name only and GET fetches', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Carol' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ contact: { id: string } }>().contact.id;
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ contact: { firstName: string } }>().contact.firstName).toBe('Carol');
  });

  it('POST rejects missing firstName with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { lastName: 'NoFirst' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('POST with companyId links to that company', async () => {
    const company = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'LinkedCo' },
    });
    const companyId = company.json<{ company: { id: string } }>().company.id;
    const contact = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Linked', companyId },
    });
    expect(contact.statusCode).toBe(201);
    expect(contact.json<{ contact: { companyId: string } }>().contact.companyId).toBe(companyId);
  });

  it('PATCH assigns then unassigns the company (companyId: null clears it)', async () => {
    const company = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'AssignCo' },
    });
    const companyId = company.json<{ company: { id: string } }>().company.id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Assignable' },
    });
    const id = created.json<{ contact: { id: string } }>().contact.id;

    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
      payload: { companyId },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json<{ contact: { companyId: string | null } }>().contact.companyId).toBe(
      companyId,
    );

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
      payload: { companyId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<{ contact: { companyId: string | null } }>().contact.companyId).toBeNull();
  });

  it('PATCH updates partial fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Patchable' },
    });
    const id = created.json<{ contact: { id: string } }>().contact.id;
    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
      payload: { title: 'CTO' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ contact: { title: string } }>().contact.title).toBe('CTO');
  });

  it('DELETE returns 204 then GET 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'DelMe' },
    });
    const id = created.json<{ contact: { id: string } }>().contact.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(404);
  });

  it('401 when not authed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Contacts customFields', () => {
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

  it('PATCH /contacts/:id merges valid customFields', async () => {
    const { cookie } = await signupTestUser(app);
    // Create a definition
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'contact', name: 'Lead Source', type: 'text' },
    });
    const fieldId = def.json().id;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'Sarah' },
    });
    const contactId = created.json().contact.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${contactId}`,
      headers: { cookie },
      payload: { customFields: { [fieldId]: 'Referral' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().contact.customFields).toEqual({ [fieldId]: 'Referral' });
  });

  it('PATCH rejects unknown custom field key with 400', async () => {
    const { cookie } = await signupTestUser(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X' },
    });
    const id = created.json().contact.id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
      payload: { customFields: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /contacts/:id returns customFields', async () => {
    const { cookie } = await signupTestUser(app);
    const def = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'contact', name: 'Notes', type: 'text' },
    });
    const fieldId = def.json().id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'X', customFields: { [fieldId]: 'hello' } },
    });
    const id = created.json().contact.id;
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie },
    });
    expect(got.json().contact.customFields).toEqual({ [fieldId]: 'hello' });
  });
});
