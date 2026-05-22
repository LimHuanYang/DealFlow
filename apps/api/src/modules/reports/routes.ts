import type { FastifyInstance } from 'fastify';
import type { Database } from '@dealflow/db';
import type { DashboardResponse } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ReportsRepo } from './reports.repo.js';

export interface ReportsRoutesDeps {
  db: Database;
}

export async function registerReportsRoutes(
  app: FastifyInstance,
  deps: ReportsRoutesDeps,
): Promise<void> {
  const repo = new ReportsRepo(deps.db);

  app.get('/api/v1/reports/dashboard', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const [kpis, pipelineByStage, dealsTrend, activityVolume, topOpenDeals] = await Promise.all([
      repo.getKpis(orgId),
      repo.getPipelineByStage(orgId),
      repo.getDealsTrend(orgId),
      repo.getActivityVolume(orgId),
      repo.getTopOpenDeals(orgId),
    ]);
    const payload: DashboardResponse = {
      kpis,
      pipelineByStage,
      dealsTrend,
      activityVolume,
      topOpenDeals,
    };
    return reply.send(payload);
  });
}
