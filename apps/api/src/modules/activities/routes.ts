import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import type { Database, schema as schemaType } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  ERROR_CODES,
  createActivityBodySchema,
  listTasksQuerySchema,
  updateActivityBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { validateAndMergeCustomFields } from '../../lib/custom-fields-merge.js';
import { ActivitiesRepo } from './activities.repo.js';

const idParamSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z
  .object({
    contactId: z.string().uuid().optional(),
    companyId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
  })
  .refine((v) => (v.contactId ? 1 : 0) + (v.companyId ? 1 : 0) + (v.dealId ? 1 : 0) === 1, {
    message: 'Set exactly one of contactId, companyId, dealId',
  });

function publicActivity(row: typeof schemaType.activities.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    status: row.status,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    contactId: row.contactId,
    companyId: row.companyId,
    dealId: row.dealId,
    ownerUserId: row.ownerUserId,
    customFields: (row.customFields as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Verify the parent entity (contact/company/deal) lives in this org. Returns
 * `true` if the parent exists in `orgId`, otherwise `false`. Performs a
 * single-row existence query per call.
 */
async function parentExistsInOrg(
  db: Database,
  orgId: string,
  parent: { contactId?: string; companyId?: string; dealId?: string },
): Promise<boolean> {
  if (parent.contactId) {
    const [row] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(eq(schema.contacts.organizationId, orgId), eq(schema.contacts.id, parent.contactId)),
      )
      .limit(1);
    return !!row;
  }
  if (parent.companyId) {
    const [row] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(
        and(eq(schema.companies.organizationId, orgId), eq(schema.companies.id, parent.companyId)),
      )
      .limit(1);
    return !!row;
  }
  if (parent.dealId) {
    const [row] = await db
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, orgId), eq(schema.deals.id, parent.dealId)))
      .limit(1);
    return !!row;
  }
  return false;
}

export async function registerActivitiesRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new ActivitiesRepo(deps.db);

  app.post('/api/v1/activities', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createActivityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid activity payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const ok = await parentExistsInOrg(deps.db, orgId, parsed.data);
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Parent entity not found' } });
    }
    const noteOrTask: 'note' | 'task' = parsed.data.kind === 'task' ? 'task' : 'note';
    const merge = await validateAndMergeCustomFields(
      { db: deps.db },
      {
        orgId,
        entityType: noteOrTask,
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
    const created = await repo.create(orgId, req.user!.id, {
      ...parsed.data,
      customFields: merge.merged,
    });
    return reply.status(201).send({ activity: publicActivity(created) });
  });

  app.get('/api/v1/activities', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Provide exactly one of contactId, companyId, dealId',
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const rows = await repo.listForParent(orgId, parsed.data);
    return reply.send({ items: rows.map(publicActivity) });
  });

  app.get('/api/v1/activities/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const row = await repo.findById(orgId, params.data.id);
    if (!row) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    return reply.send({ activity: publicActivity(row) });
  });

  app.get('/api/v1/activities/:id/events', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    // Tenant check: verify the activity belongs to this org. Avoid leaking
    // existence to other tenants — return 404 either way.
    const [act] = await deps.db
      .select({ id: schema.activities.id })
      .from(schema.activities)
      .where(
        and(eq(schema.activities.organizationId, orgId), eq(schema.activities.id, params.data.id)),
      )
      .limit(1);
    if (!act) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    const rows = await deps.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, params.data.id))
      .orderBy(desc(schema.emailEvents.occurredAt));
    const items = rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      url: r.url,
      occurredAt: r.occurredAt.toISOString(),
    }));
    return reply.send({ items });
  });

  app.patch('/api/v1/activities/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const body = updateActivityBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const existing = await repo.findById(orgId, params.data.id);
    if (!existing) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    const noteOrTask: 'note' | 'task' = existing.kind === 'task' ? 'task' : 'note';
    const merge = await validateAndMergeCustomFields(
      { db: deps.db },
      {
        orgId,
        entityType: noteOrTask,
        existing: (existing.customFields ?? {}) as Record<string, unknown>,
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
    const updated = await repo.update(orgId, params.data.id, {
      ...body.data,
      customFields: merge.merged,
    });
    if (!updated) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    return reply.send({ activity: publicActivity(updated) });
  });

  app.delete('/api/v1/activities/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const ok = await repo.delete(orgId, params.data.id);
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Activity not found' } });
    }
    return reply.status(204).send();
  });

  app.get('/api/v1/tasks', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listTasksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid task filter',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const rows = await repo.listTasks(orgId, parsed.data);
    return reply.send({ items: rows.map(publicActivity) });
  });
}
