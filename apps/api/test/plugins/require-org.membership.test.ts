import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../helpers/postgres.js';
import { buildTestApp } from '../helpers/build-app.js';
import { signupTestUser } from '../helpers/auth.js';

/**
 * A3: requireOrg loads the caller's org_members row onto req.membership.
 *
 * These tests exercise the membership guard through a real requireOrg-protected
 * route (GET /api/v1/organizations/current):
 *  - a session whose current_org_id points at an org the user is NOT a member
 *    of must 403 with NOT_A_MEMBER.
 *  - a normal member/owner session must still 200 (no regression — proves the
 *    membership lookup succeeds and does not break existing requireOrg routes).
 */
describe('requireOrg membership loading', () => {
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

  it('403 NOT_A_MEMBER when current org has no membership for the caller', async () => {
    // userA owns orgA.
    const userA = await signupTestUser(app, { orgName: 'OtherOrg' });
    // userB has their own org + session.
    const userB = await signupTestUser(app, { orgName: 'MyOrg' });

    // Point userB's session at orgA, where userB has no org_members row.
    await testDb.db
      .update(schema.sessions)
      .set({ currentOrgId: userA.orgId })
      .where(eq(schema.sessions.userId, userB.userId));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie: userB.cookie },
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'NOT_A_MEMBER',
    );
  });

  it('200 for a normal member/owner session (membership loads without breaking requireOrg)', async () => {
    const { cookie } = await signupTestUser(app, { orgName: 'MemberOrg' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { organization: { name: string } }).organization.name).toBe(
      'MemberOrg',
    );
  });
});
