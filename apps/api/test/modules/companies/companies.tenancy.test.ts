import { afterAll, beforeAll, describe } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { assertTenantIsolation } from '../../helpers/tenant-isolation.js';

describe('Companies tenancy', () => {
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

  async function createCompanyForOrgA(app: FastifyInstance, cookie: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie },
      payload: { name: 'OrgA Co' },
    });
    return res.json<{ company: { id: string } }>().company.id;
  }

  assertTenantIsolation('GET /api/v1/companies/:id', () => app, {
    method: 'GET',
    url: (id) => `/api/v1/companies/${id}`,
    createResource: (app, cookie) => createCompanyForOrgA(app, cookie),
  });

  assertTenantIsolation('PATCH /api/v1/companies/:id', () => app, {
    method: 'PATCH',
    url: (id) => `/api/v1/companies/${id}`,
    body: { name: 'hijack' },
    createResource: (app, cookie) => createCompanyForOrgA(app, cookie),
  });

  assertTenantIsolation('DELETE /api/v1/companies/:id', () => app, {
    method: 'DELETE',
    url: (id) => `/api/v1/companies/${id}`,
    createResource: (app, cookie) => createCompanyForOrgA(app, cookie),
  });
});
