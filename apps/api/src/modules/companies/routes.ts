import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database, schema } from '@dealflow/db';
import {
  ERROR_CODES,
  createCompanyBodySchema,
  updateCompanyBodySchema,
  paginationQuerySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { CompaniesRepo } from './companies.repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });

function publicCompany(row: typeof schema.companies.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size: row.size,
    website: row.website,
    description: row.description,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerCompaniesRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new CompaniesRepo(deps.db);

  app.get('/api/v1/companies', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = paginationQuerySchema
      .extend({ q: z.string().min(1).optional() })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid query' },
      });
    }
    const result = await repo.list(req.session!.currentOrgId!, parsed.data);
    return reply.send({
      items: result.items.map(publicCompany),
      nextCursor: result.nextCursor,
    });
  });

  app.post('/api/v1/companies', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createCompanyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid company payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const created = await repo.create(req.session!.currentOrgId!, parsed.data);
    return reply.status(201).send({ company: publicCompany(created) });
  });

  app.get('/api/v1/companies/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const company = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!company) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Company not found' },
      });
    }
    return reply.send({ company: publicCompany(company) });
  });

  app.patch('/api/v1/companies/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const body = updateCompanyBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' },
      });
    }
    const updated = await repo.update(req.session!.currentOrgId!, params.data.id, body.data);
    if (!updated) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Company not found' },
      });
    }
    return reply.send({ company: publicCompany(updated) });
  });

  app.delete('/api/v1/companies/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Company not found' },
      });
    }
    return reply.status(204).send();
  });
}
