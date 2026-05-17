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
