import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Deals routes (CRUD)', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let pipelineId: string;
  let leadStageId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    const auth = await signupTestUser(app);
    cookie = auth.cookie;
    const piped = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: { cookie },
    });
    const p = piped.json<{
      pipelines: { id: string; stages: { id: string; name: string }[] }[];
    }>().pipelines[0]!;
    pipelineId = p.id;
    leadStageId = p.stages.find((s) => s.name === 'Lead')!.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('POST creates a deal at end of column', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie },
      payload: { name: 'New Deal', pipelineId, stageId: leadStageId, value: 5000 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ deal: { id: string; value: number; status: string } }>();
    expect(body.deal.value).toBe(5000);
    expect(body.deal.status).toBe('open');
  });

  it('GET list returns items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/deals?pipelineId=${pipelineId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json<{ items: unknown[] }>().items)).toBe(true);
  });

  it('PATCH updates partial fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie },
      payload: { name: 'Patchable', pipelineId, stageId: leadStageId },
    });
    const id = created.json<{ deal: { id: string } }>().deal.id;
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${id}`,
      headers: { cookie },
      payload: { value: 12345 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ deal: { value: number } }>().deal.value).toBe(12345);
  });

  it('DELETE returns 204 then GET 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie },
      payload: { name: 'DelMe', pipelineId, stageId: leadStageId },
    });
    const id = created.json<{ deal: { id: string } }>().deal.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/deals/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
    const fetched = await app.inject({
      method: 'GET',
      url: `/api/v1/deals/${id}`,
      headers: { cookie },
    });
    expect(fetched.statusCode).toBe(404);
  });

  it('POST validates required name + stage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie },
      payload: { pipelineId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('401 when not authed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/deals' });
    expect(res.statusCode).toBe(401);
  });
});
