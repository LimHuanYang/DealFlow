import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { PipelineStagesRepo } from '../../../src/modules/pipelines/stages.repo.js';
import { PipelinesRepo } from '../../../src/modules/pipelines/pipelines.repo.js';

describe('PipelineStagesRepo', () => {
  let testDb: TestDatabase;
  let stages: PipelineStagesRepo;
  let pipelines: PipelinesRepo;
  let orgId: string;
  let pipelineId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    pipelines = new PipelinesRepo(testDb.db);
    stages = new PipelineStagesRepo(testDb.db);
    const p = await pipelines.create(orgId, { name: 'Sales', isDefault: true });
    pipelineId = p.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('createMany inserts in order_index order', async () => {
    const created = await stages.createMany(orgId, pipelineId, [
      { name: 'Lead', orderIndex: 1, winProbability: 10, isWon: false, isLost: false },
      { name: 'Qualified', orderIndex: 2, winProbability: 25, isWon: false, isLost: false },
    ]);
    expect(created).toHaveLength(2);
    const fetched = await stages.listForPipeline(orgId, pipelineId);
    expect(fetched.map((s) => s.name)).toEqual(['Lead', 'Qualified']);
  });
});
