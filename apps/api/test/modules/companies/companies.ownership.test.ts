import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Record-ownership enforcement for companies (Team-Management, Phase B).
 *
 * Seeds ONE org with an owner, an admin, and two members. The owner is created
 * via signup (which also creates the org). Each additional role is a *real*
 * signed-up user — so we get a valid signed session cookie for free — that we
 * then graft into the owner's org by (a) inserting an `org_members` row with
 * the desired role and (b) pointing their existing session's `current_org_id`
 * at the owner's org. The auth-context preHandler resolves the cookie to that
 * session row by id, so flipping `current_org_id` in the DB is all it takes to
 * make the caller act inside the shared org with the assigned role.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Companies record ownership', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  let orgId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let memberA: SeededMember;
  let memberB: SeededMember;

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

    admin = await seedMemberInOrg(orgId, 'admin');
    memberA = await seedMemberInOrg(orgId, 'member');
    memberB = await seedMemberInOrg(orgId, 'member');

    const members = await testDb.db
      .select({ userId: schema.orgMembers.userId, role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.organizationId, orgId));
    expect(members).toHaveLength(4);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  async function createCompanyAs(member: SeededMember, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie: member.cookie },
      payload: { name },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ company: { id: string } }>().company.id;
  }

  it('create as memberA sets ownerUserId to memberA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/companies',
      headers: { cookie: memberA.cookie },
      payload: { name: 'OwnedByA' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ company: { ownerUserId: string } }>().company.ownerUserId).toBe(
      memberA.userId,
    );
  });

  it("memberB cannot PATCH memberA's company (403 FORBIDDEN)", async () => {
    const id = await createCompanyAs(memberA, 'PatchTargetA');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { industry: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it("memberB cannot DELETE memberA's company (403 FORBIDDEN)", async () => {
    const id = await createCompanyAs(memberA, 'DeleteTargetA');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('memberA can PATCH their own company', async () => {
    const id = await createCompanyAs(memberA, 'OwnPatch');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberA.cookie },
      payload: { industry: 'SaaS' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ company: { industry: string } }>().company.industry).toBe('SaaS');
  });

  it('memberA can DELETE their own company', async () => {
    const id = await createCompanyAs(memberA, 'OwnDelete');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it("admin can PATCH memberA's company (admin bypass)", async () => {
    const id = await createCompanyAs(memberA, 'AdminPatchTarget');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: admin.cookie },
      payload: { industry: 'Touched by admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ company: { industry: string } }>().company.industry).toBe('Touched by admin');
  });

  it("owner can DELETE memberA's company (owner bypass)", async () => {
    const id = await createCompanyAs(memberA, 'OwnerDeleteTarget');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('member cannot reassign ownerUserId on their own company (forbidden)', async () => {
    const id = await createCompanyAs(memberB, 'ReassignAttempt');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { ownerUserId: memberA.userId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(after.json<{ company: { ownerUserId: string } }>().company.ownerUserId).toBe(
      memberB.userId,
    );
  });

  it('admin can reassign ownerUserId (owner/admin may reassign)', async () => {
    const id = await createCompanyAs(memberA, 'AdminReassign');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/companies/${id}`,
      headers: { cookie: admin.cookie },
      payload: { ownerUserId: memberB.userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ company: { ownerUserId: string } }>().company.ownerUserId).toBe(
      memberB.userId,
    );
  });
});
