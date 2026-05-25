import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SmtpEmailProvider } from '@dealflow/email';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContactWithEmail(
  app: FastifyInstance,
  cookie: string,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName: 'Sarah', email },
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

describe('POST /api/v1/emails — tracking + cc/bcc', () => {
  it('persists cc/bcc and tracking_enabled when supplied', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: {
        contactId,
        subject: 'Hi',
        body: 'Hello there',
        cc: ['x@x.com'],
        bcc: ['y@y.com'],
        trackEnabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const activity = (res.json() as { activity: Record<string, unknown> }).activity;
    expect(activity.ccEmails).toEqual(['x@x.com']);
    expect(activity.bccEmails).toEqual(['y@y.com']);
    expect(activity.trackingEnabled).toBe(true);
    expect(activity.deliveryStatus).toBe('sent');
    expect(activity.openCount).toBe(0);
    expect(activity.clickCount).toBe(0);
    await app.close();
    await testDb.stop();
  });

  it('defaults trackEnabled to true when omitted', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b' },
    });
    expect((res.json() as { activity: { trackingEnabled: boolean } }).activity.trackingEnabled).toBe(
      true,
    );
    await app.close();
    await testDb.stop();
  });

  it('persists trackEnabled=false when caller opts out', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b', trackEnabled: false },
    });
    expect(
      (res.json() as { activity: { trackingEnabled: boolean } }).activity.trackingEnabled,
    ).toBe(false);
    await app.close();
    await testDb.stop();
  });

  it('writes an email_events sent row on success', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b' },
    });
    const activityId = (res.json() as { activity: { id: string } }).activity.id;
    const events = await testDb.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, activityId));
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('sent');
    await app.close();
    await testDb.stop();
  });

  it('rejects cc with an invalid email', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Hi', body: 'b', cc: ['not-an-email'] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    await testDb.stop();
  });
});
