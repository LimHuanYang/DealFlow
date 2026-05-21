import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SmtpEmailProvider } from '@dealflow/email';
import { startTestPostgres } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName, email },
    headers: { cookie },
  });
  return (res.json() as { contact: { id: string } }).contact.id;
}

function fakeSmtp(messageId = '<msg_test@dealflow>') {
  const transport = {
    sendMail: async () => ({
      messageId,
      accepted: ['x'],
      rejected: [],
      response: '250 OK',
    }),
  };
  return new SmtpEmailProvider({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport: transport as any,
  });
}

describe('GET /api/v1/email/status', () => {
  it('reports disabled when no email provider wired', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email/status',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; from: string | null };
    expect(body.enabled).toBe(false);
    expect(body.from).toBeNull();
    await app.close();
    await testDb.stop();
  });

  it('reports enabled + from when provider wired', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email/status',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; from: string };
    expect(body.enabled).toBe(true);
    expect(body.from).toBe('noreply@dealflow.app');
    await app.close();
    await testDb.stop();
  });
});

describe('POST /api/v1/emails', () => {
  it('503 EMAIL_DISABLED when no provider wired', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: 'hi', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_DISABLED');
    await app.close();
    await testDb.stop();
  });

  it('400 when contact has no email address', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'NoEmail' },
      headers: { cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: 'hi', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('CONTACT_HAS_NO_EMAIL');
    await app.close();
    await testDb.stop();
  });

  it('404 when contact does not exist in this org', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: {
        contactId: '00000000-0000-0000-0000-000000000001',
        subject: 'hi',
        body: 'hello',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
    await testDb.stop();
  });

  it('201 — sends email, returns activity with kind=email + subject + externalId', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp('msg_canned_xyz'),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: {
        contactId,
        subject: 'Re: pricing',
        body: 'Hi Alice, here is pricing.',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      activity: {
        kind: string;
        subject: string | null;
        body: string;
        externalId: string | null;
      };
    };
    expect(body.activity.kind).toBe('email');
    expect(body.activity.subject).toBe('Re: pricing');
    expect(body.activity.body).toBe('Hi Alice, here is pricing.');
    expect(body.activity.externalId).toBe('msg_canned_xyz');
    await app.close();
    await testDb.stop();
  });

  it('400 when validation fails (empty subject)', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: '', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });

  it('502 EMAIL_UPSTREAM_ERROR when provider throws', async () => {
    const failingTransport = {
      sendMail: async () => {
        throw new Error('upstream boom');
      },
    };
    const failingProvider = new SmtpEmailProvider({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transport: failingTransport as any,
    });
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: failingProvider,
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContact(app, cookie, 'Alice', 'alice@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      payload: { contactId, subject: 'hi', body: 'hello' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe('EMAIL_UPSTREAM_ERROR');
    await app.close();
    await testDb.stop();
  });
});
