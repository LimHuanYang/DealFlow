import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import { dashboardResponseSchema } from '@dealflow/shared';

describe('GET /api/v1/reports/dashboard', () => {
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

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('returns a schema-valid payload for an authed empty org', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/reports/dashboard',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => dashboardResponseSchema.parse(body)).not.toThrow();
    expect(body.kpis.totalContacts).toBe(0);
    expect(body.pipelineByStage).toEqual([]);
    expect(body.dealsTrend).toHaveLength(6);
    expect(body.activityVolume).toHaveLength(8);
    expect(body.topOpenDeals).toEqual([]);
  });
});
