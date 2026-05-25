import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import { signTrackingToken } from '../../../src/lib/email-tracking-token.js';

const SECRET = 'a'.repeat(64);

async function createEmailActivity(
  testDb: TestDatabase,
  orgId: string,
  userId: string,
  contactId: string,
  trackingEnabled = true,
): Promise<string> {
  const [row] = await testDb.db
    .insert(schema.activities)
    .values({
      organizationId: orgId,
      ownerUserId: userId,
      kind: 'email',
      body: 'Hi',
      contactId,
      trackingEnabled,
    })
    .returning();
  return row!.id;
}

describe('GET /track/open/:token', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db, env: { EMAIL_TRACKING_SECRET: SECRET } });
  }, 30_000);
  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns 200 + a tiny GIF for a valid token', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);

    const res = await app.inject({ method: 'GET', url: `/track/open/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('inserts an open event row and increments counters', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id);
    const token = signTrackingToken(activityId, SECRET);

    await app.inject({ method: 'GET', url: `/track/open/${token}` });
    await app.inject({ method: 'GET', url: `/track/open/${token}` });

    const [row] = await testDb.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, activityId));
    expect(row!.openCount).toBe(2);
    expect(row!.firstOpenedAt).not.toBeNull();
    expect(row!.lastOpenedAt).not.toBeNull();

    const events = await testDb.db
      .select()
      .from(schema.emailEvents)
      .where(eq(schema.emailEvents.activityId, activityId));
    expect(events.filter((e) => e.eventType === 'open')).toHaveLength(2);
  });

  it('skips event when tracking_enabled=false on the activity', async () => {
    const { userId, orgId } = await signupTestUser(app);
    const [contact] = await testDb.db
      .insert(schema.contacts)
      .values({ organizationId: orgId, firstName: 'X' })
      .returning();
    const activityId = await createEmailActivity(testDb, orgId, userId, contact!.id, false);
    const token = signTrackingToken(activityId, SECRET);

    const res = await app.inject({ method: 'GET', url: `/track/open/${token}` });
    expect(res.statusCode).toBe(200);
    const [row] = await testDb.db
      .select()
      .from(schema.activities)
      .where(eq(schema.activities.id, activityId));
    expect(row!.openCount).toBe(0);
  });

  it('returns 200 + GIF for a forged token (no event written)', async () => {
    const res = await app.inject({ method: 'GET', url: '/track/open/garbage.badsig' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
  });
});
