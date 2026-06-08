import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Role-gating for integration (SMTP/AI config) mutations (Team-Management,
 * Phase B5). Saving/updating/testing org-level integration credentials is
 * restricted to owner/admin; plain members may only read (GET) the masked view.
 *
 * Seeds ONE org with an owner (signup) and a grafted-in member, mirroring the
 * `seedMemberInOrg` pattern from contacts.ownership.test.ts.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Integration mutations are owner/admin-only', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let orgId: string;
  let owner: SeededMember;
  let member: SeededMember;

  async function seedMemberInOrg(targetOrgId: string, role: OrgRole): Promise<SeededMember> {
    const auth = await signupTestUser(app);
    await testDb.db
      .insert(schema.orgMembers)
      .values({ organizationId: targetOrgId, userId: auth.userId, role });
    await testDb.db
      .update(schema.sessions)
      .set({ currentOrgId: targetOrgId })
      .where(eq(schema.sessions.userId, auth.userId));
    return { cookie: auth.cookie, userId: auth.userId };
  }

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });

    const ownerAuth = await signupTestUser(app);
    owner = { cookie: ownerAuth.cookie, userId: ownerAuth.userId };
    orgId = ownerAuth.orgId;
    member = await seedMemberInOrg(orgId, 'member');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('member gets 403 FORBIDDEN on PATCH (save integration config)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie: member.cookie },
      payload: { anthropic: { apiKey: 'sk-ant-MEMBER123', model: 'claude-sonnet-4-5' } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('owner gets 200 on PATCH (save integration config)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/integrations',
      headers: { cookie: owner.cookie },
      payload: { anthropic: { apiKey: 'sk-ant-OWNER1234', model: 'claude-sonnet-4-5' } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('member can still GET the masked integrations view', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/integrations',
      headers: { cookie: member.cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
