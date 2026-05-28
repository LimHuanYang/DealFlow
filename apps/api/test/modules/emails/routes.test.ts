import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SmtpEmailProvider } from '@dealflow/email';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
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
    expect(
      (res.json() as { activity: { trackingEnabled: boolean } }).activity.trackingEnabled,
    ).toBe(true);
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

describe('GET /api/v1/emails (dashboard list)', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns sent emails for the caller org', async () => {
    const { cookie } = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');
    // Send 2 emails.
    await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'First', body: 'b' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: { contactId, subject: 'Second', body: 'b' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?range=all',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].subject).toBeDefined();
    expect(items[0].recipientEmail).toBe('sarah@acme.com');
  });

  it('enforces tenant isolation', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    const contactId = await createContactWithEmail(app, a.cookie, 's@s.com');
    await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie: a.cookie },
      payload: { contactId, subject: 'Hi', body: 'b' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?range=all',
      headers: { cookie: b.cookie },
    });
    expect(res.json().items).toEqual([]);
  });

  it('filters by status=failed', async () => {
    // Setup: directly insert a failed activity, then a sent one.
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X', email: 's@s.com' })
      .returning();
    await testDb.db.insert(schema.activities).values([
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        subject: 'Failed one',
        contactId: contact!.id,
        deliveryStatus: 'failed',
      },
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        subject: 'Sent one',
        contactId: contact!.id,
        deliveryStatus: 'sent',
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?status=failed&range=all',
      headers: { cookie },
    });
    expect(
      res.json().items.every((i: { deliveryStatus: string }) => i.deliveryStatus === 'failed'),
    ).toBe(true);
  });

  it('q searches subject case-insensitively', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X', email: 's@s.com' })
      .returning();
    await testDb.db.insert(schema.activities).values({
      organizationId: orgId,
      ownerUserId: userId,
      kind: 'email',
      body: 'b',
      subject: 'Q3 PROPOSAL plan',
      contactId: contact!.id,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/emails?q=proposal&range=all',
      headers: { cookie },
    });
    const hits = res.json().items;
    expect(
      hits.some((i: { subject: string }) => i.subject.toLowerCase().includes('proposal')),
    ).toBe(true);
  });
});

describe('GET /api/v1/emails/engagement/:entityType/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns a zero rollup when entity has no sent emails', async () => {
    const { cookie, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/engagement/contact/${contact!.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.sent).toBe(0);
    expect(r.opened).toBe(0);
    expect(r.openedPct).toBe(0);
    expect(r.clickedWith).toBe(0);
    expect(r.lastActivityAt).toBeNull();
  });

  it('computes counts and percentages correctly', async () => {
    const { cookie, userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    // 4 emails: 2 opened (1 also clicked), 2 untouched.
    await testDb.db.insert(schema.activities).values([
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'a',
        contactId: contact!.id,
        openCount: 2,
        clickCount: 1,
      },
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'b',
        contactId: contact!.id,
        openCount: 1,
        clickCount: 0,
      },
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'c',
        contactId: contact!.id,
        openCount: 0,
        clickCount: 0,
      },
      {
        organizationId: orgId,
        ownerUserId: userId,
        kind: 'email',
        body: 'd',
        contactId: contact!.id,
        openCount: 0,
        clickCount: 0,
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/engagement/contact/${contact!.id}`,
      headers: { cookie },
    });
    const r = res.json();
    expect(r.sent).toBe(4);
    expect(r.opened).toBe(2);
    expect(r.openedPct).toBeCloseTo(0.5, 5);
    expect(r.clickedWith).toBe(1);
    expect(r.clickedWithPct).toBeCloseTo(0.25, 5);
  });

  it('400s on an unknown entity type', async () => {
    const { cookie, orgId } = await signupTestUser(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/emails/engagement/widget/${orgId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/emails — attachments (multipart)', () => {
  it('accepts one file and persists an attachment row', async () => {
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

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 'with file', body: 'see attached' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('fake pdf bytes')], { type: 'application/pdf' }),
      'doc.pdf',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    const activityId = (res.json() as { activity: { id: string } }).activity.id;

    const rows = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.activityId, activityId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.filename).toBe('doc.pdf');
    expect(rows[0]!.mimeType).toBe('application/pdf');
    expect(rows[0]!.sizeBytes).toBe(14);

    await app.close();
    await testDb.stop();
  });

  it('still works with a JSON-only payload (no attachments, backward compat)', async () => {
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
      payload: { contactId, subject: 'no files', body: 'plain' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
    await testDb.stop();
  });

  it('rejects a blocked extension (.exe)', async () => {
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

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 's', body: 'b' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('MZ')], { type: 'application/octet-stream' }),
      'installer.exe',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('ATTACHMENT_BLOCKED_TYPE');

    await app.close();
    await testDb.stop();
  });

  it('caches files with an expiry when org uses default (30 days)', async () => {
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

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 's', body: 'b' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('hi')], { type: 'text/plain' }),
      'note.txt',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    const activityId = (res.json() as { activity: { id: string } }).activity.id;

    const rows = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.activityId, activityId));
    expect(rows[0]!.cachePath).not.toBeNull();
    expect(rows[0]!.cacheExpiresAt).not.toBeNull();

    await app.close();
    await testDb.stop();
  });

  it('never-cache org setting yields NULL cacheExpiresAt but still caches the file', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({
      db: testDb.db,
      emailProviderForOrg: async () => ({
        provider: fakeSmtp(),
        fromAddress: 'noreply@dealflow.app',
      }),
    });
    const { cookie } = await signupTestUser(app);

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie },
      payload: { email: { attachmentCacheDays: 'never' } },
    });

    const contactId = await createContactWithEmail(app, cookie, 'sarah@acme.com');

    const form = new FormData();
    form.append('body', JSON.stringify({ contactId, subject: 's', body: 'b' }));
    form.append(
      'attachments',
      new Blob([Buffer.from('hi')], { type: 'text/plain' }),
      'note.txt',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/emails',
      headers: { cookie },
      payload: form,
    });
    expect(res.statusCode).toBe(201);
    const activityId = (res.json() as { activity: { id: string } }).activity.id;

    const rows = await testDb.db
      .select()
      .from(schema.emailAttachments)
      .where(eq(schema.emailAttachments.activityId, activityId));
    expect(rows[0]!.cachePath).not.toBeNull();
    expect(rows[0]!.cacheExpiresAt).toBeNull();

    await app.close();
    await testDb.stop();
  });
});
