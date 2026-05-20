import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { type AIProvider, AIDisabledError } from '@dealflow/ai';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  ERROR_CODES,
  summarizeActivityBodySchema,
  extractContactBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';

const MAX_ACTIVITIES = 50;
const MAX_CONTEXT_CHARS = 4000;

export interface AIRoutesDeps {
  db: Database;
  aiProvider: AIProvider;
  aiChainDescription: Array<{ name: string; model: string }>;
}

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

function buildActivityContext(
  activities: { kind: string; body: string; createdAt: Date; dueAt: Date | null }[],
): string {
  const lines: string[] = [];
  let chars = 0;
  for (const a of activities.slice(0, MAX_ACTIVITIES)) {
    const when = a.createdAt.toISOString().slice(0, 10);
    const tag =
      a.kind === 'task'
        ? `task${a.dueAt ? ` due ${a.dueAt.toISOString().slice(0, 10)}` : ''}`
        : 'note';
    const line = `[${when}] [${tag}] ${a.body}`;
    if (chars + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

function aiDisabled(reply: FastifyReply) {
  return reply.status(503).send({
    error: {
      code: 'AI_DISABLED',
      message: 'AI is not configured on this DealFlow instance.',
    },
  });
}

function aiUpstreamError(reply: FastifyReply) {
  return reply.status(502).send({
    error: { code: 'AI_UPSTREAM_ERROR', message: 'AI provider request failed.' },
  });
}

export async function registerAIRoutes(app: FastifyInstance, deps: AIRoutesDeps): Promise<void> {
  const activities = new ActivitiesRepo(deps.db);
  const enabled = deps.aiChainDescription.length > 0;

  app.get('/api/v1/ai/status', { preHandler: requireOrg }, async (_req, reply) => {
    return reply.send({ enabled, providers: deps.aiChainDescription });
  });

  app.post('/api/v1/ai/summarize-activity', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = summarizeActivityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Provide exactly one of contactId, companyId, dealId',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    if (!enabled) return aiDisabled(reply);

    const orgId = req.session!.currentOrgId!;
    const ok = await parentExistsInOrg(deps.db, orgId, parsed.data);
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Parent not found' } });
    }

    const rows = await activities.listForParent(orgId, parsed.data);
    if (rows.length === 0) {
      return reply.send({ summary: 'No activity yet.' });
    }
    const context = buildActivityContext(rows);
    try {
      const out = await deps.aiProvider.summarizeNote({ text: context });
      return reply.send({ summary: out.summary });
    } catch (err) {
      if (err instanceof AIDisabledError) return aiDisabled(reply);
      req.log.error({ err }, 'summarize-activity: all providers failed');
      return aiUpstreamError(reply);
    }
  });

  app.post('/api/v1/ai/extract-contact', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = extractContactBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid text',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    if (!enabled) return aiDisabled(reply);

    try {
      const extracted = await deps.aiProvider.extractContact({ text: parsed.data.text });
      return reply.send({ extracted });
    } catch (err) {
      if (err instanceof AIDisabledError) return aiDisabled(reply);
      req.log.error({ err }, 'extract-contact: all providers failed');
      return aiUpstreamError(reply);
    }
  });
}
