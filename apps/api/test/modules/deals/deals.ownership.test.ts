import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Record-ownership enforcement for deals (Team-Management, Phase B).
 *
 * Seeds ONE org with an owner, an admin, and two members. The owner is created
 * via signup (which also creates the org + a default pipeline). Each additional
 * role is a *real* signed-up user — so we get a valid signed session cookie for
 * free — that we then graft into the owner's org by (a) inserting an
 * `org_members` row with the desired role and (b) pointing their existing
 * session's `current_org_id` at the owner's org.
 *
 * Deals additionally guard POST /:id/move: a member may only move deals they
 * own; owner/admin may move any.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Deals record ownership', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  let orgId: string;
  let owner: SeededMember;
  let admin: SeededMember;
  let memberA: SeededMember;
  let memberB: SeededMember;

  let pipelineId: string;
  let leadStageId: string;
  let qualifiedStageId: string;

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

    // All four members share the org's default pipeline.
    const piped = await app.inject({
      method: 'GET',
      url: '/api/v1/pipelines',
      headers: { cookie: owner.cookie },
    });
    const p = piped.json<{
      pipelines: { id: string; stages: { id: string; name: string }[] }[];
    }>().pipelines[0]!;
    pipelineId = p.id;
    leadStageId = p.stages.find((s) => s.name === 'Lead')!.id;
    qualifiedStageId = p.stages.find((s) => s.name === 'Qualified')!.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  async function createDealAs(member: SeededMember, name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie: member.cookie },
      payload: { name, pipelineId, stageId: leadStageId },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ deal: { id: string } }>().deal.id;
  }

  it('create as memberA sets ownerUserId to memberA', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deals',
      headers: { cookie: memberA.cookie },
      payload: { name: 'OwnedByA', pipelineId, stageId: leadStageId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ deal: { ownerUserId: string } }>().deal.ownerUserId).toBe(memberA.userId);
  });

  it("memberB cannot PATCH memberA's deal (403 FORBIDDEN)", async () => {
    const id = await createDealAs(memberA, 'PatchTargetA');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { value: 999 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it("memberB cannot DELETE memberA's deal (403 FORBIDDEN)", async () => {
    const id = await createDealAs(memberA, 'DeleteTargetA');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    const stillThere = await app.inject({
      method: 'GET',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(stillThere.statusCode).toBe(200);
  });

  it("memberB cannot MOVE memberA's deal (403 FORBIDDEN)", async () => {
    const id = await createDealAs(memberA, 'MoveTargetA');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie: memberB.cookie },
      payload: { stageId: qualifiedStageId, positionInStage: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    // The deal must not have moved.
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(after.json<{ deal: { stageId: string } }>().deal.stageId).toBe(leadStageId);
  });

  it('memberA can MOVE their own deal', async () => {
    const id = await createDealAs(memberA, 'OwnMove');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie: memberA.cookie },
      payload: { stageId: qualifiedStageId, positionInStage: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ deal: { stageId: string } }>().deal.stageId).toBe(qualifiedStageId);
  });

  it('memberA can PATCH their own deal', async () => {
    const id = await createDealAs(memberA, 'OwnPatch');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberA.cookie },
      payload: { value: 4242 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ deal: { value: number } }>().deal.value).toBe(4242);
  });

  it('memberA can DELETE their own deal', async () => {
    const id = await createDealAs(memberA, 'OwnDelete');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberA.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it("admin can PATCH memberA's deal (admin bypass)", async () => {
    const id = await createDealAs(memberA, 'AdminPatchTarget');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: admin.cookie },
      payload: { value: 7000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ deal: { value: number } }>().deal.value).toBe(7000);
  });

  it("owner can MOVE memberA's deal (owner bypass)", async () => {
    const id = await createDealAs(memberA, 'OwnerMoveTarget');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/deals/${id}/move`,
      headers: { cookie: owner.cookie },
      payload: { stageId: qualifiedStageId, positionInStage: 2 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ deal: { stageId: string } }>().deal.stageId).toBe(qualifiedStageId);
  });

  it("owner can DELETE memberA's deal (owner bypass)", async () => {
    const id = await createDealAs(memberA, 'OwnerDeleteTarget');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(204);
  });

  it('member cannot reassign ownerUserId on their own deal (forbidden)', async () => {
    const id = await createDealAs(memberB, 'ReassignAttempt');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberB.cookie },
      payload: { ownerUserId: memberA.userId },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: memberB.cookie },
    });
    expect(after.json<{ deal: { ownerUserId: string } }>().deal.ownerUserId).toBe(memberB.userId);
  });

  it('admin can reassign ownerUserId (owner/admin may reassign)', async () => {
    const id = await createDealAs(memberA, 'AdminReassign');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/deals/${id}`,
      headers: { cookie: admin.cookie },
      payload: { ownerUserId: memberB.userId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ deal: { ownerUserId: string } }>().deal.ownerUserId).toBe(memberB.userId);
  });
});
