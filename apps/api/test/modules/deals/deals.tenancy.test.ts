import { afterAll, beforeAll, describe } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { assertTenantIsolation } from '../../helpers/tenant-isolation.js';

describe('Deals tenancy', () => {
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

  async function createDealForOrgA(app: FastifyInstance, cookie: string): Promise<string> {
    const piped = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: { cookie },
    });
    const p = piped.json<{
      pipelines: { id: string; stages: { id: string; name: string }[] }[];
    }>().pipelines[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie },
      payload: {
        name: 'OrgA Deal',
        pipelineId: p.id,
        stageId: p.stages.find((s) => s.name === 'Lead')!.id,
      },
    });
    return res.json<{ deal: { id: string } }>().deal.id;
  }

  assertTenantIsolation('GET /api/v1/deals/:id', () => app, {
    method: 'GET',
    url: (id) => `/api/v1/deals/${id}`,
    createResource: (app, cookie) => createDealForOrgA(app, cookie),
  });

  assertTenantIsolation('PATCH /api/v1/deals/:id', () => app, {
    method: 'PATCH',
    url: (id) => `/api/v1/deals/${id}`,
    body: { name: 'hijack' },
    createResource: (app, cookie) => createDealForOrgA(app, cookie),
  });

  assertTenantIsolation('DELETE /api/v1/deals/:id', () => app, {
    method: 'DELETE',
    url: (id) => `/api/v1/deals/${id}`,
    createResource: (app, cookie) => createDealForOrgA(app, cookie),
  });
});
