import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import {
  createCustomFieldBodySchema,
  customFieldEntityTypeSchema,
  ERROR_CODES,
  updateCustomFieldBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { CustomFieldsRepo } from './repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({ entity: customFieldEntityTypeSchema });

export interface CustomFieldsRoutesDeps {
  db: Database;
}

export async function registerCustomFieldsRoutes(
  app: FastifyInstance,
  deps: CustomFieldsRoutesDeps,
): Promise<void> {
  const repo = new CustomFieldsRepo(deps.db);

  app.get('/api/v1/custom-fields', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'entity query required' } });
    }
    const rows = await repo.list(req.session!.currentOrgId!, parsed.data.entity);
    return reply.send(rows);
  });

  app.post('/api/v1/custom-fields', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createCustomFieldBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid custom field',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    try {
      const created = await repo.create(req.session!.currentOrgId!, parsed.data);
      return reply.status(201).send(created);
    } catch (err) {
      if (err instanceof Error && /duplicate key/i.test(err.message)) {
        return reply.status(409).send({
          error: { code: ERROR_CODES.CONFLICT, message: 'Field name already exists for this entity' },
        });
      }
      throw err;
    }
  });

  app.patch('/api/v1/custom-fields/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    const body = updateCustomFieldBodySchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid update' } });
    }
    const updated = await repo.update(req.session!.currentOrgId!, params.data.id, body.data);
    if (!updated) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Field not found' } });
    return reply.send(updated);
  });

  app.delete('/api/v1/custom-fields/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Bad id' } });
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Field not found' } });
    return reply.status(204).send();
  });
}
