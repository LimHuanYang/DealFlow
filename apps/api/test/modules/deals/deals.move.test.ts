import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('POST /api/v1/deals/:id/move', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let pipelineId: string;
  let leadStageId: string;
  let qualifiedStageId: string;
  let wonStageId: string;
  let lostStageId: string;

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
    qualifiedStageId = p.stages.find((s) => s.name === 'Qualified')!.id;
    wonStageId = p.stages.find((s) => s.name === 'Closed Won')!.id;
    lostStageId = p.stages.find((s) => s.name === 'Closed Lost')!.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  async function newDeal(name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie },
      payload: { name, pipelineId, stageId: leadStageId },
    });
    return res.json<{ deal: { id: string } }>().deal.id;
  }

  it('moves between non-terminal stages, keeps status=open', async () => {
    const id = await newDeal('Mover');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie },
      payload: { stageId: qualifiedStageId, positionInStage: 1.5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ deal: { stageId: string; status: string; closedAt: string | null } }>();
    expect(body.deal.stageId).toBe(qualifiedStageId);
    expect(body.deal.status).toBe('open');
    expect(body.deal.closedAt).toBeNull();
  });

  it('moves to Closed Won, sets status=won + closedAt', async () => {
    const id = await newDeal('Winner');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie },
      payload: { stageId: wonStageId, positionInStage: 0 },
    });
    const body = res.json<{ deal: { status: string; closedAt: string | null } }>();
    expect(body.deal.status).toBe('won');
    expect(body.deal.closedAt).not.toBeNull();
  });

  it('moves to Closed Lost, sets status=lost + closedAt', async () => {
    const id = await newDeal('Loser');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie },
      payload: { stageId: lostStageId, positionInStage: 0 },
    });
    const body = res.json<{ deal: { status: string; closedAt: string | null } }>();
    expect(body.deal.status).toBe('lost');
    expect(body.deal.closedAt).not.toBeNull();
  });

  it('rejects invalid stage id with 400', async () => {
    const id = await newDeal('Bad');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie },
      payload: { stageId: 'not-a-uuid', positionInStage: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown deal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals/00000000-0000-0000-0000-000000000000/move',
      headers: { cookie },
      payload: { stageId: leadStageId, positionInStage: 0 },
    });
    expect(res.statusCode).toBe(404);
  });
});
