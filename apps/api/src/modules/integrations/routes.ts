import type { FastifyInstance } from 'fastify';
import type { Database } from '@dealflow/db';
import { ERROR_CODES, updateIntegrationsBodySchema } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { OrgIntegrationsRepo } from './repo.js';

export interface IntegrationsRoutesDeps {
  db: Database;
  encryptionKey: Buffer;
}

export async function registerIntegrationsRoutes(
  app: FastifyInstance,
  deps: IntegrationsRoutesDeps,
): Promise<void> {
  const repo = new OrgIntegrationsRepo(deps.db, deps.encryptionKey);

  app.get('/api/v1/integrations', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const masked = await repo.getMasked(orgId);
    return reply.send(masked);
  });

  app.patch('/api/v1/integrations', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = updateIntegrationsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid integrations patch',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    await repo.update(orgId, parsed.data);
    const masked = await repo.getMasked(orgId);
    return reply.send(masked);
  });
}
