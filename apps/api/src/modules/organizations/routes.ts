import type { FastifyInstance } from 'fastify';
import type { Database, schema } from '@dealflow/db';
import { ERROR_CODES, updateOrganizationBodySchema } from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { OrgsRepo } from '../auth/orgs.repo.js';

function publicOrg(row: typeof schema.organizations.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    defaultCurrency: row.defaultCurrency,
  };
}

export async function registerOrganizationsRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const orgsRepo = new OrgsRepo(deps.db);

  app.get(
    '/api/v1/organizations/current',
    { preHandler: requireOrg },
    async (req, reply) => {
      const orgId = req.session!.currentOrgId!;
      const org = await orgsRepo.findById(orgId);
      if (!org) {
        return reply
          .status(404)
          .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Organization not found' } });
      }
      return reply.send({ organization: publicOrg(org) });
    },
  );

  app.patch(
    '/api/v1/organizations/current',
    { preHandler: requireOrg },
    async (req, reply) => {
      const parsed = updateOrganizationBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Invalid organization update payload',
            details: parsed.error.flatten().fieldErrors,
          },
        });
      }
      const orgId = req.session!.currentOrgId!;
      const updated = await orgsRepo.update(orgId, parsed.data);
      if (!updated) {
        return reply
          .status(404)
          .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Organization not found' } });
      }
      return reply.send({ organization: publicOrg(updated) });
    },
  );
}
