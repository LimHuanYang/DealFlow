import { afterAll, beforeAll, describe } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { assertTenantIsolation } from '../../helpers/tenant-isolation.js';

describe('Contacts tenancy', () => {
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

  async function createContactForOrgA(app: FastifyInstance, cookie: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie },
      payload: { firstName: 'OrgA' },
    });
    return res.json<{ contact: { id: string } }>().contact.id;
  }

  assertTenantIsolation('GET /api/v1/contacts/:id', () => app, {
    method: 'GET',
    url: (id) => `/api/v1/contacts/${id}`,
    createResource: (app, cookie) => createContactForOrgA(app, cookie),
  });

  assertTenantIsolation('PATCH /api/v1/contacts/:id', () => app, {
    method: 'PATCH',
    url: (id) => `/api/v1/contacts/${id}`,
    body: { firstName: 'hijack' },
    createResource: (app, cookie) => createContactForOrgA(app, cookie),
  });

  assertTenantIsolation('DELETE /api/v1/contacts/:id', () => app, {
    method: 'DELETE',
    url: (id) => `/api/v1/contacts/${id}`,
    createResource: (app, cookie) => createContactForOrgA(app, cookie),
  });
});
