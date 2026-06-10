import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('GET /api/v1/integrations', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/integrations' });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty masked view for a fresh org', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      anthropic: { configured: boolean };
    };
    expect(body.anthropic.configured).toBe(false);
  });
});

describe('PATCH /api/v1/integrations', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('saves an Anthropic key, GET returns the mask', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      payload: { anthropic: { apiKey: 'sk-ant-XYZW1234', model: 'claude-sonnet-4-5' } },
      headers: { cookie },
    });
    expect(patch.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    const body = get.json() as {
      anthropic: { configured: boolean; apiKeyMask: string; model: string | null };
    };
    expect(body.anthropic.configured).toBe(true);
    expect(body.anthropic.apiKeyMask).toBe('1234');
    expect(body.anthropic.model).toBe('claude-sonnet-4-5');
  });

  it('clearing with null removes the provider', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      payload: { gemini: { apiKey: 'g-test' } },
      headers: { cookie },
    });
    const after = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      payload: { gemini: null },
      headers: { cookie },
    });
    expect(after.statusCode).toBe(200);
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    expect((get.json() as { gemini: { configured: boolean } }).gemini.configured).toBe(false);
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/integrations/test-ai', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns ok=false when the provider has no key configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/test-ai',
      payload: { provider: 'anthropic' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('400 on bad provider name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/test-ai',
      payload: { provider: 'openai' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/integrations/test-email', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns ok=false when email is not configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/test-email',
      payload: {},
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });
});

describe('EngineMailer email integration routes', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    // The EngineMailer API key is app-wide (server env); inject it via the test
    // env override so the route reports apiKeyConfigured/connected.
    app = await buildTestApp({
      db: testDb.db,
      env: { ENGINE_MAILER_API_KEY: 'test-em-key-abcdef' },
    });
    ({ cookie } = await signupTestUser(app));
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('PATCH /integrations/email saves the sender identity; GET returns the mask', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations/email',
      payload: { fromName: 'Acme Sales', fromEmail: 'crm@acme.com' },
      headers: { cookie },
    });
    expect(patch.statusCode).toBe(200);
    const pj = patch.json() as {
      apiKeyConfigured: boolean;
      connected: boolean;
      fromEmail: string;
    };
    expect(pj.apiKeyConfigured).toBe(true);
    expect(pj.connected).toBe(true);
    expect(pj.fromEmail).toBe('crm@acme.com');

    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/email',
      headers: { cookie },
    });
    const gj = get.json() as { connected: boolean; fromName: string };
    expect(gj.connected).toBe(true);
    expect(gj.fromName).toBe('Acme Sales');
  });

  it('updates the sender identity', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations/email',
      payload: { fromName: 'Acme Renamed', fromEmail: 'hello@acme.com' },
      headers: { cookie },
    });
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations/email',
      headers: { cookie },
    });
    const gj = get.json() as { connected: boolean; fromName: string; fromEmail: string };
    expect(gj.connected).toBe(true);
    expect(gj.fromName).toBe('Acme Renamed');
    expect(gj.fromEmail).toBe('hello@acme.com');
  });

  it('400 on invalid fromEmail', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations/email',
      payload: { fromName: 'X', fromEmail: 'not-an-email' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations/email',
      payload: { fromName: 'X', fromEmail: 'x@y.com' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Integrations PATCH — email.attachmentCacheDays', () => {
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

  it('persists a valid value', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: '7' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email.attachmentCacheDays).toBe('7');
  });

  it('defaults to 30 when never set', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    expect(res.json().email.attachmentCacheDays).toBe('30');
  });

  it('rejects an invalid value', async () => {
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: '60' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts "never" and round-trips', async () => {
    const { cookie } = await signupTestUser(app);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: 'never' } },
    });
    expect(patch.json().email.attachmentCacheDays).toBe('never');
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    expect(get.json().email.attachmentCacheDays).toBe('never');
  });
});
