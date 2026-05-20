import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FallbackAIProvider, AnthropicAIProvider } from '@dealflow/ai';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName },
    headers: { cookie },
  });
  return (res.json() as { contact: { id: string } }).contact.id;
}

// Build a real AnthropicAIProvider with a fake SDK that returns a canned response.
function fakeAnthropic(text: string) {
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text }] }),
    },
  };
  return new AnthropicAIProvider({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    model: 'claude-haiku-4-5',
  });
}

describe('GET /api/v1/ai/status (no chain)', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    expect(res.statusCode).toBe(401);
  });

  it('reports disabled (empty providers) when no keys are wired', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/status',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; providers: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.providers).toEqual([]);
  });
});

describe('GET /api/v1/ai/status (with chain wired)', () => {
  it('reports the chain in order', async () => {
    const testDb = await startTestPostgres();
    const providers = [fakeAnthropic('x'), fakeAnthropic('y')];
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider(providers),
      aiChainDescription: [
        { name: 'anthropic', model: 'claude-haiku-4-5' },
        { name: 'gemini', model: 'gemini-2.5-flash' },
      ],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/status',
      headers: { cookie },
    });
    const body = res.json() as { enabled: boolean; providers: Array<{ name: string }> };
    expect(body.enabled).toBe(true);
    expect(body.providers.map((p) => p.name)).toEqual(['anthropic', 'gemini']);
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/ai/summarize-activity', () => {
  it('returns 503 with AI_DISABLED when chain is empty', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AI_DISABLED');
    await app.close();
    await testDb.stop();
  });

  it('400 when no parent id', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: {},
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });

  it('200 with summary when chain succeeds', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic('CANNED SUMMARY')]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Bob');
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'Bob said hi', contactId },
      headers: { cookie },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { summary: string }).summary).toBe('CANNED SUMMARY');
    await app.close();
    await testDb.stop();
  });

  it('404 when parent contact not in org', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic('x')]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId: '00000000-0000-0000-0000-000000000001' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
    await testDb.stop();
  });

  it('502 when all providers in the chain fail', async () => {
    const testDb = await startTestPostgres();
    const failingClient = {
      messages: {
        create: async () => {
          throw new Error('upstream boom');
        },
      },
    };
    const failing = new AnthropicAIProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: failingClient as any,
      model: 'claude-haiku-4-5',
    });
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([failing]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Carol');
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'hi', contactId },
      headers: { cookie },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/summarize-activity',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AI_UPSTREAM_ERROR');
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/ai/extract-contact', () => {
  it('returns structured fields when chain succeeds', async () => {
    const testDb = await startTestPostgres();
    const json = JSON.stringify({ firstName: 'Dan', email: 'd@x.com' });
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic(json)]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/extract-contact',
      payload: { text: 'Dan d@x.com' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { extracted: { firstName: string; email: string } };
    expect(body.extracted.firstName).toBe('Dan');
    expect(body.extracted.email).toBe('d@x.com');
    await app.close();
    await testDb.stop();
  });

  it('400 on empty text', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/extract-contact',
      payload: { text: '' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/ai/draft-email', () => {
  it('returns 503 with AI_DISABLED when chain is empty', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId, intent: 'follow up' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('AI_DISABLED');
    await app.close();
    await testDb.stop();
  });

  it('200 with subject + body on success', async () => {
    const testDb = await startTestPostgres();
    const draftJson = JSON.stringify({ subject: 'Hello Alice', body: 'Hi Alice,\nFollowing up.' });
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([fakeAnthropic(draftJson)]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId, intent: 'follow up' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { subject: string; body: string };
    expect(body.subject).toBe('Hello Alice');
    expect(body.body).toMatch(/Alice/);
    await app.close();
    await testDb.stop();
  });

  it('404 when contact not in org', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      aiProvider: new FallbackAIProvider([
        fakeAnthropic(JSON.stringify({ subject: 's', body: 'b' })),
      ]),
      aiChainDescription: [{ name: 'anthropic', model: 'claude-haiku-4-5' }],
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId: '00000000-0000-0000-0000-000000000001', intent: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
    await testDb.stop();
  });

  it('400 when intent is missing', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/draft-email',
      payload: { contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });
});
