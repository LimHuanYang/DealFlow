import type { FastifyInstance } from 'fastify';
import type { Database, schema } from '@dealflow/db';
import { requireOrg } from '../../plugins/require-org.js';
import { PipelinesRepo } from './pipelines.repo.js';
import { PipelineStagesRepo } from './stages.repo.js';

function publicStage(row: typeof schema.pipelineStages.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.orderIndex,
    winProbability: row.winProbability,
    isWon: row.isWon,
    isLost: row.isLost,
  };
}

export async function registerPipelinesRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const pipelinesRepo = new PipelinesRepo(deps.db);
  const stagesRepo = new PipelineStagesRepo(deps.db);

  app.get('/api/v1/pipelines', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const pipelines = await pipelinesRepo.listForOrg(orgId);
    const result = await Promise.all(
      pipelines.map(async (p) => ({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        stages: (await stagesRepo.listForPipeline(orgId, p.id)).map(publicStage),
      })),
    );
    return reply.send({ pipelines: result });
  });
}
