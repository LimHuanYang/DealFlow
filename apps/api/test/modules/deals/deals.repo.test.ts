import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { DealsRepo } from '../../../src/modules/deals/deals.repo.js';
import { createDefaultPipeline } from '../../../src/modules/pipelines/seed.js';

describe('DealsRepo', () => {
  let testDb: TestDatabase;
  let repo: DealsRepo;
  let orgId: string;
  let userId: string;
  let pipelineId: string;
  let leadStageId: string;
  let qualifiedStageId: string;
  let wonStageId: string;
  let lostStageId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: `u${Date.now()}@example.com`, name: 'U', passwordHash: 'x' })
      .returning();
    userId = user!.id;
    const { pipeline, stages } = await createDefaultPipeline(testDb.db, orgId);
    pipelineId = pipeline.id;
    leadStageId = stages.find((s) => s.name === 'Lead')!.id;
    qualifiedStageId = stages.find((s) => s.name === 'Qualified')!.id;
    wonStageId = stages.find((s) => s.name === 'Closed Won')!.id;
    lostStageId = stages.find((s) => s.name === 'Closed Lost')!.id;
    repo = new DealsRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create assigns positionInStage = last + 1 within the target stage', async () => {
    const d1 = await repo.create(orgId, userId, { name: 'Deal A', pipelineId, stageId: leadStageId });
    const d2 = await repo.create(orgId, userId, { name: 'Deal B', pipelineId, stageId: leadStageId });
    expect(d2.positionInStage).toBeGreaterThan(d1.positionInStage);
    expect(d2.status).toBe('open');
    expect(d2.organizationId).toBe(orgId);
    expect(d2.ownerUserId).toBe(userId);
  });

  it('list returns only org rows', async () => {
    const list = await repo.list(orgId, { pipelineId });
    expect(list.every((d) => d.organizationId === orgId)).toBe(true);
  });

  it('moveToStage between non-terminal stages keeps status=open and closedAt=null', async () => {
    const d = await repo.create(orgId, userId, { name: 'Mover', pipelineId, stageId: leadStageId });
    const moved = await repo.moveToStage(orgId, d.id, qualifiedStageId, 1.5);
    expect(moved?.stageId).toBe(qualifiedStageId);
    expect(moved?.status).toBe('open');
    expect(moved?.closedAt).toBeNull();
    expect(moved?.positionInStage).toBe(1.5);
  });

  it('moveToStage to a won stage sets status=won + closedAt', async () => {
    const d = await repo.create(orgId, userId, { name: 'Winner', pipelineId, stageId: leadStageId });
    const moved = await repo.moveToStage(orgId, d.id, wonStageId, 0);
    expect(moved?.status).toBe('won');
    expect(moved?.closedAt).toBeInstanceOf(Date);
  });

  it('moveToStage to a lost stage sets status=lost + closedAt', async () => {
    const d = await repo.create(orgId, userId, { name: 'Loser', pipelineId, stageId: leadStageId });
    const moved = await repo.moveToStage(orgId, d.id, lostStageId, 0);
    expect(moved?.status).toBe('lost');
    expect(moved?.closedAt).toBeInstanceOf(Date);
  });

  it('moveToStage returns null for a deal in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const { pipeline: op, stages: os } = await createDefaultPipeline(testDb.db, otherOrg!.id);
    const foreign = await repo.create(otherOrg!.id, userId, {
      name: 'Foreign',
      pipelineId: op.id,
      stageId: os.find((s) => s.name === 'Lead')!.id,
    });
    expect(await repo.moveToStage(orgId, foreign.id, qualifiedStageId, 1)).toBeNull();
  });

  it('update merges partial fields; delete removes only same-org', async () => {
    const d = await repo.create(orgId, userId, { name: 'Patchable', pipelineId, stageId: leadStageId });
    const updated = await repo.update(orgId, d.id, { value: 50000, currency: 'USD' });
    expect(updated?.value).toBe('50000.00');
    const ok = await repo.delete(orgId, d.id);
    expect(ok).toBe(true);
    expect(await repo.findById(orgId, d.id)).toBeNull();
  });
});
