import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { schema } from '@dealflow/db';
import { eq } from 'drizzle-orm';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { OrgIntegrationsRepo } from '../../../src/modules/integrations/repo.js';

const TEST_KEY = randomBytes(32);

describe('OrgIntegrationsRepo', () => {
  let testDb: TestDatabase;
  let repo: OrgIntegrationsRepo;
  let orgId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    repo = new OrgIntegrationsRepo(testDb.db, TEST_KEY);
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('get returns an empty integrations bundle for a fresh org', async () => {
    const out = await repo.getDecrypted(orgId);
    expect(out.anthropic).toBeNull();
    expect(out.gemini).toBeNull();
    expect(out.grok).toBeNull();
    expect(out.smtp).toBeNull();
  });

  it('update sets Anthropic, get round-trips', async () => {
    await repo.update(orgId, {
      anthropic: { apiKey: 'sk-ant-test', model: 'claude-sonnet-4-5' },
    });
    const out = await repo.getDecrypted(orgId);
    expect(out.anthropic).toEqual({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-5' });
  });

  it('update with null clears the provider', async () => {
    await repo.update(orgId, {
      gemini: { apiKey: 'g-test' },
    });
    expect((await repo.getDecrypted(orgId)).gemini?.apiKey).toBe('g-test');
    await repo.update(orgId, { gemini: null });
    expect((await repo.getDecrypted(orgId)).gemini).toBeNull();
  });

  it('Anthropic apiKey is stored encrypted (not as plaintext) in the DB', async () => {
    await repo.update(orgId, {
      anthropic: { apiKey: 'sk-ant-shouldnt-be-plaintext', model: 'claude-haiku-4-5' },
    });
    const [row] = await testDb.db
      .select({ integrations: schema.organizations.integrations })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);
    const stored = row!.integrations as Record<string, unknown>;
    const stringified = JSON.stringify(stored);
    expect(stringified).not.toContain('sk-ant-shouldnt-be-plaintext');
  });

  it('SMTP round-trip including the password', async () => {
    await repo.update(orgId, {
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        user: 'a@b.com',
        pass: 'secret-pw',
        fromEmail: 'a@b.com',
        fromName: 'Alice',
      },
    });
    const out = await repo.getDecrypted(orgId);
    expect(out.smtp).toEqual({
      host: 'smtp.gmail.com',
      port: 587,
      user: 'a@b.com',
      pass: 'secret-pw',
      fromEmail: 'a@b.com',
      fromName: 'Alice',
    });
  });

  it('getMasked returns last-4 of apiKey + empty passMask', async () => {
    await repo.update(orgId, {
      anthropic: { apiKey: 'sk-ant-XYZW1234', model: 'claude-haiku-4-5' },
      smtp: {
        host: 'h',
        port: 587,
        user: 'u',
        pass: 'p',
        fromEmail: 'u@x.com',
      },
    });
    const out = await repo.getMasked(orgId);
    expect(out.anthropic.configured).toBe(true);
    expect(out.anthropic.apiKeyMask).toBe('1234');
    expect(out.anthropic.model).toBe('claude-haiku-4-5');
    expect(out.smtp.configured).toBe(true);
    expect(out.smtp.passMask).toBe('');
    expect(out.smtp.host).toBe('h');
    expect(out.smtp.user).toBe('u');
    expect(out.smtp.fromEmail).toBe('u@x.com');
  });

  it('partial update preserves other providers', async () => {
    await repo.update(orgId, {
      anthropic: { apiKey: 'first', model: 'm1' },
      gemini: { apiKey: 'g-first' },
    });
    await repo.update(orgId, { anthropic: { apiKey: 'second', model: 'm2' } });
    const out = await repo.getDecrypted(orgId);
    expect(out.anthropic?.apiKey).toBe('second');
    expect(out.gemini?.apiKey).toBe('g-first');
  });
});
