import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Record-ownership enforcement for activities (Team-Management, Phase B).
 *
 * Notes, tasks and emails are all `activities` rows; create already stamps
 * owner_user_id from the acting user (req.user.id) for every kind. This suite
 * proves the PATCH/DELETE guards: owner/admin may edit any activity, a member
 * only those they own, else 403 FORBIDDEN — and a member cannot reassign
 * ownerUserId.
 *
 * Seeds ONE org with an owner, an admin, and two members (see seedMemberInOrg).
 * A single parent contact (created by the owner) is shared by all activities —
 * the parent-exists check is org-scoped, not owner-scoped.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Activities record ownership', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  let orgId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let memberA: SeededMember;
  let memberB: SeededMember;

  let contactId: string;

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

    // Shared parent contact for every activity in this suite.
    const c = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { cookie: owner.cookie },
      payload: { firstName: 'Parent' },
    });
    expect(c.statusCode).toBe(201);
    contactId = c.json<{ contact: { id: string } }>().contact.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  async function createActivityAs(
    member: SeededMember,
    kind: 'note' | 'task',
    body: string,
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      headers: { cookie: member.cookie },
      payload: { kind, body, contactId },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ activity: { id: string } }>().activity.id;
  }

  it('create note as memberA sets ownerUserId to memberA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      headers: { cookie: memberA.cookie },
      payload: { kind: 'note', body: 'OwnedByA', contactId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ activity: { ownerUserId: string } }>().activity.ownerUserId).toBe(
      memberA.userId,
    );
  });

  it('create task as memberA sets ownerUserId to memberA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      headers: { cookie: memberA.cookie },
      payload: { kind: 'task', body: 'TaskByA', contactId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ activity: { ownerUserId: string } }>().activity.ownerUserId).toBe(
      memberA.userId,
    );
  });

  it("memberB cannot PATCH memberA's note (403 FORBIDDEN)", async () => {
    const id = await createActivityAs(memberA, 'note', 'PatchNoteA');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { body: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it("memberB cannot PATCH memberA's task (403 FORBIDDEN)", async () => {
    const id = await createActivityAs(memberA, 'task', 'PatchTaskA');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it("memberB cannot DELETE memberA's note (403 FORBIDDEN)", async () => {
    const id = await createActivityAs(memberA, 'note', 'DeleteNoteA');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    // The row must survive a forbidden delete.
    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it('memberA can PATCH their own task', async () => {
    const id = await createActivityAs(memberA, 'task', 'OwnTask');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberA.cookie },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ activity: { status: string } }>().activity.status).toBe('done');
  });

  it('memberA can DELETE their own note', async () => {
    const id = await createActivityAs(memberA, 'note', 'OwnDeleteNote');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it("admin can PATCH memberA's note (admin bypass)", async () => {
    const id = await createActivityAs(memberA, 'note', 'AdminPatchTarget');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: admin.cookie },
      payload: { body: 'Touched by admin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ activity: { body: string } }>().activity.body).toBe('Touched by admin');
  });

  it("owner can DELETE memberA's task (owner bypass)", async () => {
    const id = await createActivityAs(memberA, 'task', 'OwnerDeleteTarget');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('member cannot reassign ownerUserId on their own activity (forbidden)', async () => {
    const id = await createActivityAs(memberB, 'note', 'ReassignAttempt');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { ownerUserId: memberA.userId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(after.json<{ activity: { ownerUserId: string } }>().activity.ownerUserId).toBe(
      memberB.userId,
    );
  });

  it('admin can reassign ownerUserId (owner/admin may reassign)', async () => {
    const id = await createActivityAs(memberA, 'note', 'AdminReassign');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${id}`,
      headers: { cookie: admin.cookie },
      payload: { ownerUserId: memberB.userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ activity: { ownerUserId: string } }>().activity.ownerUserId).toBe(
      memberB.userId,
    );
  });
});
