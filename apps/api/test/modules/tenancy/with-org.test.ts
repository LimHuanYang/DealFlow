import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { withOrg } from '../../../src/modules/tenancy/with-org.js';

describe('withOrg(orgId)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestPostgres();
  }, 30_000);

  afterAll(() => testDb.stop());

  it('scopes queries to a single organization (count helper)', async () => {
    const [orgA] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'A', slug: `a-${Date.now()}` })
      .returning();
    const [orgB] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'B', slug: `b-${Date.now()}` })
      .returning();
    const [userA] = await testDb.db
      .insert(schema.users)
      .values({ email: `a${Date.now()}@x.com`, name: 'A' })
      .returning();
    const [userB] = await testDb.db
      .insert(schema.users)
      .values({ email: `b${Date.now()}@x.com`, name: 'B' })
      .returning();
    await testDb.db.insert(schema.orgMembers).values({
      organizationId: orgA!.id,
      userId: userA!.id,
      role: 'owner',
    });
    await testDb.db.insert(schema.orgMembers).values({
      organizationId: orgB!.id,
      userId: userB!.id,
      role: 'owner',
    });

    const scopeA = withOrg(testDb.db, orgA!.id);
    const scopeB = withOrg(testDb.db, orgB!.id);

    expect(await scopeA.count(schema.orgMembers, schema.orgMembers.organizationId)).toBe(1);
    expect(await scopeB.count(schema.orgMembers, schema.orgMembers.organizationId)).toBe(1);
  });
});
