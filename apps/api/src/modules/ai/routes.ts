import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
  buildAIProvider,
  describeChain,
  AIDisabledError,
  type AIConfig,
  type AIProvider,
} from '@dealflow/ai';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  ERROR_CODES,
  summarizeActivityBodySchema,
  extractContactBodySchema,
  draftEmailBodySchema,
} from '@dealflow/shared';
import { requireOrg } from '../../plugins/require-org.js';
import { ActivitiesRepo } from '../activities/activities.repo.js';
import { OrgIntegrationsRepo } from '../integrations/repo.js';

const MAX_ACTIVITIES = 50;
const MAX_CONTEXT_CHARS = 4000;

export interface AIRoutesDeps {
  db: Database;
  encryptionKey: Buffer;
  /** Optional override (tests only). When set, used instead of building from integrations. */
  aiProviderForOrg?: (orgId: string) => Promise<{
    provider: AIProvider;
    chain: Array<{ name: string; model: string }>;
  }>;
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
        : a.kind;
    const line = `[${when}] [${tag}] ${a.body}`;
    if (chars + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

function aiDisabled(reply: FastifyReply) {
  return reply
    .status(503)
    .send({
      error: { code: 'AI_DISABLED', message: 'AI is not configured for this organization.' },
    });
}

function aiUpstreamError(reply: FastifyReply) {
  return reply
    .status(502)
    .send({ error: { code: 'AI_UPSTREAM_ERROR', message: 'AI provider request failed.' } });
}

/** Build an AIConfig from the org's stored integrations. */
async function loadAIConfig(integrations: OrgIntegrationsRepo, orgId: string): Promise<AIConfig> {
  const dec = await integrations.getDecrypted(orgId);
  return {
    anthropic: dec.anthropic
      ? { apiKey: dec.anthropic.apiKey, model: dec.anthropic.model ?? 'claude-haiku-4-5' }
      : undefined,
    gemini: dec.gemini
      ? { apiKey: dec.gemini.apiKey, model: dec.gemini.model ?? 'gemini-2.5-flash' }
      : undefined,
    grok: dec.grok ? { apiKey: dec.grok.apiKey, model: dec.grok.model ?? 'grok-4' } : undefined,
  };
}

export async function registerAIRoutes(app: FastifyInstance, deps: AIRoutesDeps): Promise<void> {
  const activitiesRepo = new ActivitiesRepo(deps.db);
  const integrations = new OrgIntegrationsRepo(deps.db, deps.encryptionKey);

  /** Resolves the AI provider + chain description for an org. Test injection point. */
  async function resolveAi(orgId: string): Promise<{
    provider: AIProvider;
    chain: Array<{ name: string; model: string }>;
  }> {
    if (deps.aiProviderForOrg) return deps.aiProviderForOrg(orgId);
    const cfg = await loadAIConfig(integrations, orgId);
    const { providers } = buildAIProvider(cfg);
    return { provider: providers, chain: describeChain(cfg) };
  }

  app.get('/api/v1/ai/status', { preHandler: requireOrg }, async (req, reply) => {
    const orgId = req.session!.currentOrgId!;
    const { chain } = await resolveAi(orgId);
    return reply.send({ enabled: chain.length > 0, providers: chain });
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
    const orgId = req.session!.currentOrgId!;
    const { provider, chain } = await resolveAi(orgId);
    if (chain.length === 0) return aiDisabled(reply);
    const ok = await parentExistsInOrg(deps.db, orgId, parsed.data);
    if (!ok) {
      return reply.status(404).send({
        error: { code: ERROR_CODES.NOT_FOUND, message: 'Parent not found' },
      });
    }
    const rows = await activitiesRepo.listForParent(orgId, parsed.data);
    if (rows.length === 0) return reply.send({ summary: 'No activity yet.' });
    const context = buildActivityContext(rows);
    try {
      const out = await provider.summarizeNote({ text: context });
      return reply.send({ summary: out.summary });
    } catch (err) {
      if (err instanceof AIDisabledError) return aiDisabled(reply);
      req.log.error({ err }, 'summarize-activity failed');
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
    const orgId = req.session!.currentOrgId!;
    const { provider, chain } = await resolveAi(orgId);
    if (chain.length === 0) return aiDisabled(reply);
    try {
      const extracted = await provider.extractContact({ text: parsed.data.text });
      return reply.send({ extracted });
    } catch (err) {
      if (err instanceof AIDisabledError) return aiDisabled(reply);
      req.log.error({ err }, 'extract-contact failed');
      return aiUpstreamError(reply);
    }
  });

  app.post('/api/v1/ai/draft-email', { preHandler: requireOrg }, async (req, reply) => {
    const parsed = draftEmailBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid draft-email payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const orgId = req.session!.currentOrgId!;
    const { provider, chain } = await resolveAi(orgId);
    if (chain.length === 0) return aiDisabled(reply);
    const ok = await parentExistsInOrg(deps.db, orgId, { contactId: parsed.data.contactId });
    if (!ok) {
      return reply
        .status(404)
        .send({ error: { code: ERROR_CODES.NOT_FOUND, message: 'Contact not found' } });
    }
    const rows = await activitiesRepo.listForParent(orgId, { contactId: parsed.data.contactId });
    const context =
      rows.length === 0
        ? 'No prior activity with this contact yet.'
        : rows
            .slice(0, 50)
            .map((a) => `[${a.createdAt.toISOString().slice(0, 10)}] [${a.kind}] ${a.body}`)
            .join('\n');
    try {
      const out = await provider.draftEmail({
        dealContext: { id: parsed.data.contactId, summary: context },
        intent: parsed.data.intent,
      });
      return reply.send({ subject: out.subject, body: out.body });
    } catch (err) {
      if (err instanceof AIDisabledError) return aiDisabled(reply);
      req.log.error({ err }, 'ai/draft-email failed');
      return aiUpstreamError(reply);
    }
  });
}
