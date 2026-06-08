import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database, schema } from '@dealflow/db';
import {
  ERROR_CODES,
  createDealBodySchema,
  updateDealBodySchema,
  moveDealBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { DealsRepo } from './deals.repo.js';
import { validateAndMergeCustomFields } from '../../lib/custom-fields-merge.js';
import { assertCanWrite, AuthzError } from '../../lib/authz.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
});

function publicDeal(row: typeof schema.deals.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    value: row.value == null ? null : Number(row.value),
    currency: row.currency,
    primaryContactId: row.primaryContactId,
    companyId: row.companyId,
    ownerUserId: row.ownerUserId,
    expectedCloseDate: row.expectedCloseDate,
    status: row.status as 'open' | 'won' | 'lost',
    positionInStage: row.positionInStage,
    customFields: (row.customFields as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

export async function registerDealsRoutes(
  app: FastifyInstance,
  deps: { db: Database },
): Promise<void> {
  const repo = new DealsRepo(deps.db);

  app.get('/api/v1/deals', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid query' } });
    }
    const items = await repo.list(req.session!.currentOrgId!, parsed.data);
    return reply.send({ items: items.map(publicDeal) });
  });

  app.post('/api/v1/deals', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = createDealBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid deal payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const merge = await validateAndMergeCustomFields(
      { db: deps.db },
      {
        orgId: req.session!.currentOrgId!,
        entityType: 'deal',
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
    const created = await repo.create(req.session!.currentOrgId!, req.user!.id, {
      ...parsed.data,
      customFields: merge.merged,
    });
    return reply.status(201).send({ deal: publicDeal(created) });
  });

  app.get('/api/v1/deals/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' } });
    }
    const deal = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!deal) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal not found' } });
    }
    return reply.send({ deal: publicDeal(deal) });
  });

  app.patch('/api/v1/deals/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' } });
    }
    const body = updateDealBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid patch' } });
    }
    const existing = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!existing) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal not found' } });
    }
    // Record-ownership: owner/admin may edit any row; a member only their own.
    // (Checked after the 404 so non-owners can't probe which ids exist.)
    try {
      assertCanWrite(req.membership!.role, existing.ownerUserId, req.user!.id);
    } catch (e) {
      if (e instanceof AuthzError) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: e.message },
        });
      }
      throw e;
    }
    // Only owner/admin may reassign a record to a different user. A member that
    // includes `ownerUserId` (even on a record they own) is forbidden.
    if (
      body.data.ownerUserId !== undefined &&
      req.membership!.role !== 'owner' &&
      req.membership!.role !== 'admin'
    ) {
      return reply.status(403).send({
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Only an owner or admin may reassign a record.',
        },
      });
    }
    const merge = await validateAndMergeCustomFields(
      { db: deps.db },
      {
        orgId: req.session!.currentOrgId!,
        entityType: 'deal',
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
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal not found' } });
    }
    return reply.send({ deal: publicDeal(updated) });
  });

  app.delete('/api/v1/deals/:id', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' } });
    }
    const existing = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!existing) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal not found' } });
    }
    // Record-ownership: owner/admin may delete any row; a member only their own.
    // (Checked after the 404 so non-owners can't probe which ids exist.)
    try {
      assertCanWrite(req.membership!.role, existing.ownerUserId, req.user!.id);
    } catch (e) {
      if (e instanceof AuthzError) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: e.message },
        });
      }
      throw e;
    }
    const ok = await repo.delete(req.session!.currentOrgId!, params.data.id);
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal not found' } });
    }
    return reply.status(204).send();
  });

  app.post('/api/v1/deals/:id/move', { preHandler: requireOrg }, async (req, reply) => {
    const params = idParamSchema.safeParse(req.params);
    if (!params.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid id' } });
    }
    const body = moveDealBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .status(400)
        .send({ error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid move payload' } });
    }
    const existing = await repo.findById(req.session!.currentOrgId!, params.data.id);
    if (!existing) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal or stage not found' } });
    }
    // Record-ownership: owner/admin may move any deal; a member only their own.
    // (Checked after the 404 so non-owners can't probe which ids exist.)
    try {
      assertCanWrite(req.membership!.role, existing.ownerUserId, req.user!.id);
    } catch (e) {
      if (e instanceof AuthzError) {
        return reply.status(403).send({
          error: { code: ERROR_CODES.FORBIDDEN, message: e.message },
        });
      }
      throw e;
    }
    const moved = await repo.moveToStage(
      req.session!.currentOrgId!,
      params.data.id,
      body.data.stageId,
      body.data.positionInStage,
    );
    if (!moved) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Deal or stage not found' } });
    }
    return reply.send({ deal: publicDeal(moved) });
  });
}
