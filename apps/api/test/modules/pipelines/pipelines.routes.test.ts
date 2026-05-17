import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Pipelines routes', () => {
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

  it('GET /pipelines returns the default Sales pipeline with 6 stages', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      pipelines: { name: string; isDefault: boolean; stages: { name: string }[] }[];
    }>();
    expect(body.pipelines).toHaveLength(1);
    expect(body.pipelines[0]!.name).toBe('Sales');
    expect(body.pipelines[0]!.isDefault).toBe(true);
    expect(body.pipelines[0]!.stages.map((s) => s.name)).toEqual([
      'Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Closed Won',
      'Closed Lost',
    ]);
  });

  it('401 when not authed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/pipelines' });
    expect(res.statusCode).toBe(401);
  });
});
