import type { Database } from '@dealflow/db';
import type { schema } from '@dealflow/db';
import { PipelinesRepo } from './pipelines.repo.js';
import { PipelineStagesRepo, type NewStageInput } from './stages.repo.js';

const DEFAULT_STAGES: NewStageInput[] = [
  { name: 'Lead', orderIndex: 1, winProbability: 10, isWon: false, isLost: false },
  { name: 'Qualified', orderIndex: 2, winProbability: 25, isWon: false, isLost: false },
  { name: 'Proposal', orderIndex: 3, winProbability: 50, isWon: false, isLost: false },
  { name: 'Negotiation', orderIndex: 4, winProbability: 75, isWon: false, isLost: false },
  { name: 'Closed Won', orderIndex: 5, winProbability: 100, isWon: true, isLost: false },
  { name: 'Closed Lost', orderIndex: 6, winProbability: 0, isWon: false, isLost: true },
];

export interface SeedResult {
  pipeline: typeof schema.pipelines.$inferSelect;
  stages: (typeof schema.pipelineStages.$inferSelect)[];
}

/**
 * Creates the "Sales" default pipeline + 6 canonical stages for an org.
 * Called from `AuthService.signup` immediately after `addMember`. Idempotency
 * is NOT enforced here — callers must only invoke once per org.
 */
export async function createDefaultPipeline(
  db: Database,
  organizationId: string,
): Promise<SeedResult> {
  const pipelinesRepo = new PipelinesRepo(db);
  const stagesRepo = new PipelineStagesRepo(db);

  const pipeline = await pipelinesRepo.create(organizationId, {
    name: 'Sales',
    isDefault: true,
  });
  const stages = await stagesRepo.createMany(organizationId, pipeline.id, DEFAULT_STAGES);

  return { pipeline, stages };
}
