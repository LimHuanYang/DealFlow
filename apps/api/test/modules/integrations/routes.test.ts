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
      smtp: { configured: boolean };
    };
    expect(body.anthropic.configured).toBe(false);
    expect(body.smtp.configured).toBe(false);
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

  it('saves SMTP config including masking the password', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      payload: {
        smtp: {
          host: 'smtp.gmail.com',
          port: 587,
          user: 'a@b.com',
          pass: 'secret-pw',
          fromEmail: 'a@b.com',
          fromName: 'Alice',
        },
      },
      headers: { cookie },
    });
    const get = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie },
    });
    const smtp = (get.json() as {
      smtp: { configured: boolean; host: string; user: string; passMask: string };
    }).smtp;
    expect(smtp.configured).toBe(true);
    expect(smtp.host).toBe('smtp.gmail.com');
    expect(smtp.user).toBe('a@b.com');
    expect(smtp.passMask).toBe('');
  });

  it('400 on invalid payload (bad port)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      payload: { smtp: { host: 'h', port: 99999, user: 'u', pass: 'p', fromEmail: 'a@b.com' } },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
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

  it('returns ok=false when SMTP is not configured', async () => {
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
