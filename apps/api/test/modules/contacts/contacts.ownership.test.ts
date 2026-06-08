import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Record-ownership enforcement for contacts (Team-Management, Phase B).
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

describe('Contacts record ownership', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  let orgId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let memberA: SeededMember;
  let memberB: SeededMember;

  /**
   * Sign up a brand-new user (creating a throwaway org of their own), then move
   * them into `targetOrgId` with `role`: add an org_members row and repoint
   * their session's current_org_id. Returns their signed cookie + userId.
   */
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

    // Owner: signup creates the org and an `org_members` row with role 'owner'.
    const ownerAuth = await signupTestUser(app);
    owner = { cookie: ownerAuth.cookie, userId: ownerAuth.userId };
    orgId = ownerAuth.orgId;

    admin = await seedMemberInOrg(orgId, 'admin');
    memberA = await seedMemberInOrg(orgId, 'member');
    memberB = await seedMemberInOrg(orgId, 'member');

    // Sanity: all four memberships live in the same org with the right roles.
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

  async function createContactAs(member: SeededMember, firstName: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie: member.cookie },
      payload: { firstName },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ contact: { id: string } }>().contact.id;
  }

  it('create as memberA sets ownerUserId to memberA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie: memberA.cookie },
      payload: { firstName: 'OwnedByA' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ contact: { ownerUserId: string } }>().contact.ownerUserId).toBe(
      memberA.userId,
    );
  });

  it("memberB cannot PATCH memberA's contact (403 FORBIDDEN)", async () => {
    const id = await createContactAs(memberA, 'PatchTargetA');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { title: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it("memberB cannot DELETE memberA's contact (403 FORBIDDEN)", async () => {
    const id = await createContactAs(memberA, 'DeleteTargetA');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    // The row must survive a forbidden delete.
    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('memberA can PATCH their own contact', async () => {
    const id = await createContactAs(memberA, 'OwnPatch');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberA.cookie },
      payload: { title: 'CRO' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contact: { title: string } }>().contact.title).toBe('CRO');
  });

  it('memberA can DELETE their own contact', async () => {
    const id = await createContactAs(memberA, 'OwnDelete');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it("admin can PATCH memberA's contact (admin bypass)", async () => {
    const id = await createContactAs(memberA, 'AdminPatchTarget');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: admin.cookie },
      payload: { title: 'Touched by admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contact: { title: string } }>().contact.title).toBe('Touched by admin');
  });

  it("owner can DELETE memberA's contact (owner bypass)", async () => {
    const id = await createContactAs(memberA, 'OwnerDeleteTarget');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('member cannot reassign ownerUserId on their own contact (forbidden)', async () => {
    const id = await createContactAs(memberB, 'ReassignAttempt');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberB.cookie },
      // Attempt to hand the record to memberA.
      payload: { ownerUserId: memberA.userId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    // Ownership must be unchanged.
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(after.json<{ contact: { ownerUserId: string } }>().contact.ownerUserId).toBe(
      memberB.userId,
    );
  });

  it('admin can reassign ownerUserId (owner/admin may reassign)', async () => {
    const id = await createContactAs(memberA, 'AdminReassign');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: { cookie: admin.cookie },
      payload: { ownerUserId: memberB.userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ contact: { ownerUserId: string } }>().contact.ownerUserId).toBe(
      memberB.userId,
    );
  });
});
