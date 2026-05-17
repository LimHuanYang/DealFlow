import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { createDefaultPipeline } from '../../../src/modules/pipelines/seed.js';

describe('createDefaultPipeline', () => {
  let testDb: TestDatabase;
  let orgId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('creates a "Sales" pipeline with 6 stages in canonical order', async () => {
    const { pipeline, stages } = await createDefaultPipeline(testDb.db, orgId);
    expect(pipeline.name).toBe('Sales');
    expect(pipeline.isDefault).toBe(true);
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual([
      'Lead',
      'Qualified',
      'Proposal',
      'Negotiation',
      'Closed Won',
      'Closed Lost',
    ]);
    expect(stages.find((s) => s.name === 'Closed Won')!.isWon).toBe(true);
    expect(stages.find((s) => s.name === 'Closed Lost')!.isLost).toBe(true);
    expect(stages.filter((s) => s.isWon).length).toBe(1);
    expect(stages.filter((s) => s.isLost).length).toBe(1);
  });

  it('is org-scoped — separate orgs get separate pipelines', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const { pipeline: a } = await createDefaultPipeline(testDb.db, orgId);
    const { pipeline: b } = await createDefaultPipeline(testDb.db, otherOrg!.id);
    expect(a.id).not.toBe(b.id);
    expect(a.organizationId).toBe(orgId);
    expect(b.organizationId).toBe(otherOrg!.id);
  });
});
