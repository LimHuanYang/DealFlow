import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Role-gating for organization settings mutations (Team-Management, Phase B5).
 * PATCH /api/v1/organizations/current edits org-level settings (name, default
 * currency), so it is restricted to owner/admin; plain members may only read.
 *
 * Seeds ONE org with an owner (signup) and a grafted-in member, mirroring the
 * `seedMemberInOrg` pattern from contacts.ownership.test.ts.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Organization PATCH is owner/admin-only', () => {
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

    const ownerAuth = await signupTestUser(app, { orgName: 'RoleGateOrg' });
    owner = { cookie: ownerAuth.cookie, userId: ownerAuth.userId };
    orgId = ownerAuth.orgId;
    member = await seedMemberInOrg(orgId, 'member');
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('member gets 403 FORBIDDEN on PATCH /organizations/current', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      headers: { cookie: member.cookie },
      payload: { defaultCurrency: 'EUR' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('owner gets 200 on PATCH /organizations/current', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/current',
      headers: { cookie: owner.cookie },
      payload: { defaultCurrency: 'EUR' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { organization: { defaultCurrency: string } }).organization.defaultCurrency).toBe('EUR');
  });

  it('member can still GET /organizations/current', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/current',
      headers: { cookie: member.cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
