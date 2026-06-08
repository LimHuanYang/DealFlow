import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/shared';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

/**
 * Role-gating for custom-field **definition** mutations (Team-Management,
 * Phase B5). Definition CRUD is org-level schema management, so it is
 * restricted to owner/admin; plain members may only read (GET).
 *
 * Seeds ONE org with an owner (created by signup) and a member grafted in via
 * an `org_members` row + a repointed session `current_org_id` — the same
 * `seedMemberInOrg` pattern used by contacts.ownership.test.ts.
 */
interface SeededMember {
  cookie: string;
  userId: string;
}

describe('Custom-field definition mutations are owner/admin-only', () => {
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

  it('member gets 403 FORBIDDEN on POST (create definition)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie: member.cookie },
      payload: { entityType: 'contact', name: 'Member Field', type: 'text' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('owner gets 201 on POST (create definition)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie: owner.cookie },
      payload: { entityType: 'contact', name: 'Owner Field', type: 'text' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('member can still GET (list) definitions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=contact',
      headers: { cookie: member.cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
