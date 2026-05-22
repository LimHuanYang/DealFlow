import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database, schema } from '@dealflow/db';
import {
  ERROR_CODES,
  createContactBodySchema,
  updateContactBodySchema,
  paginationQuerySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ContactsRepo } from './contacts.repo.js';
import { validateAndMergeCustomFields } from '../../lib/custom-fields-merge.js';

const idParamSchema = z.object({ id: z.string().uuid() });

function publicContact(row: typeof schema.contacts.$inferSelect) {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    title: row.title,
    companyId: row.companyId,
    ownerUserId: row.ownerUserId,
    customFields: (row.customFields as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerContactsRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new ContactsRepo(deps.db);

  app.get('/api/v1/contacts', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = paginationQuerySchema
      .extend({
        q: z.string().min(1).optional(),
        companyId: z.string().uuid().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid query' },
      });
    }
    const result = await repo.list(req.session!.currentOrgId!, parsed.data);
    return reply.send({
      items: result.items.map(publicContact),
      nextCursor: result.nextCursor,
    });
  });

  app.post('/api/v1/contacts', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createContactBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid contact payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const merge = await validateAndMergeCustomFields(
      { db: deps.db },
      {
        orgId: req.session!.currentOrgId!,
        entityType: 'contact',
        existing: {},
        patch: parsed.data.customFields,
        isCreate: true,
      },
    );
    if (!merge.ok) {
      return reply.status(merge.status).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: merge.error,
          details: merge.fieldErrors,
        },
      });
    }
    const created = await repo.create(req.session!.currentOrgId!, {
      ...parsed.data,
      customFields: merge.merged,
    });
    return reply.status(201).send({ contact: publicContact(created) });
  });

  app.get('/api/v1/contacts/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const contact = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!contact) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    return reply.send({ contact: publicContact(contact) });
  });

  app.patch('/api/v1/contacts/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const body = updateContactBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' },
      });
    }
    const existing = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!existing) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    const merge = await validateAndMergeCustomFields(
      { db: deps.db },
      {
        orgId: req.session!.currentOrgId!,
        entityType: 'contact',
        existing: (existing.customFields as Record<string, unknown>) ?? {},
        patch: body.data.customFields,
        isCreate: false,
      },
    );
    if (!merge.ok) {
      return reply.status(merge.status).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: merge.error,
          details: merge.fieldErrors,
        },
      });
    }
    const updated = await repo.update(req.session!.currentOrgId!, params.data.id, {
      ...body.data,
      customFields: merge.merged,
    });
    if (!updated) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    return reply.send({ contact: publicContact(updated) });
  });

  app.delete('/api/v1/contacts/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' },
      });
    }
    return reply.status(204).send();
  });
}
