import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { registerEngineMailerWebhook } from '../../../src/modules/emails/engine-mailer-webhook.js';

const SECRET = 'test-webhook-secret-0123456789';
const TXID = 'tx-abc';

describe('POST /api/v1/webhooks/engine-mailer', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let activityId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = Fastify();
    await registerEngineMailerWebhook(app, { db: testDb.db, webhookSecret: SECRET });
    await app.ready();

    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'EM', slug: `em-wh-${Date.now()}` })
      .returning();
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: org!.id, firstName: 'Bob' })
      .returning();
    const [act] = await testDb.db
      .insert(schema.activities)
      .values({
        organizationId: org!.id,
        kind: 'note',
        body: 'email body',
        contactId: contact!.id,
        externalId: TXID,
        trackingEnabled: true,
      })
      .returning();
    activityId = act!.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  async function getActivity() {
    const [a] = await testDb.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, activityId))
      .limit(1);
    return a!;
  }

  it('rejects an invalid webhook key with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/engine-mailer?key=wrong',
      payload: { event: 'opened', details: { txid: TXID } },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a valid open event increments openCount + sets firstOpenedAt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/engine-mailer?key=${SECRET}`,
      payload: { event: 'opened', details: { txid: TXID } },
    });
    expect(res.statusCode).toBe(200);
    const a = await getActivity();
    expect(a.openCount).toBe(1);
    expect(a.firstOpenedAt).not.toBeNull();
  });

  it('a click event increments clickCount', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/engine-mailer?key=${SECRET}`,
      payload: { event: 'clicked', details: { txid: TXID, url: 'https://x.com/' } },
    });
    expect(res.statusCode).toBe(200);
    expect((await getActivity()).clickCount).toBe(1);
  });

  it('a bounce event sets deliveryStatus', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/engine-mailer?key=${SECRET}`,
      payload: { event: 'bounce', details: { txid: TXID } },
    });
    expect(res.statusCode).toBe(200);
    expect((await getActivity()).deliveryStatus).toBe('bounced');
  });

  it('an unknown event is acked (200) without changing counters', async () => {
    const before = await getActivity();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/engine-mailer?key=${SECRET}`,
      payload: { event: 'whatever', details: { txid: TXID } },
    });
    expect(res.statusCode).toBe(200);
    expect((await getActivity()).openCount).toBe(before.openCount);
  });

  it('an unmatched txid is acked (200) without error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/engine-mailer?key=${SECRET}`,
      payload: { event: 'opened', details: { txid: 'no-such-txid' } },
    });
    expect(res.statusCode).toBe(200);
  });
});
