import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { ContactsRepo } from '../../../src/modules/contacts/contacts.repo.js';
import { CompaniesRepo } from '../../../src/modules/companies/companies.repo.js';

describe('ContactsRepo', () => {
  let testDb: TestDatabase;
  let repo: ContactsRepo;
  let companies: CompaniesRepo;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: `acme-${Date.now()}` })
      .returning();
    orgId = org!.id;
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ email: `u${Date.now()}@example.com`, name: 'U', passwordHash: 'x' })
      .returning();
    userId = user!.id;
    repo = new ContactsRepo(testDb.db);
    companies = new CompaniesRepo(testDb.db);
  }, 30_000);

  afterAll(() => testDb.stop());

  it('create + findById within org', async () => {
    const created = await repo.create(orgId, userId, {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
    });
    expect(created.firstName).toBe('Alice');
    expect(created.organizationId).toBe(orgId);
    expect(created.ownerUserId).toBe(userId);

    const found = await repo.findById(orgId, created.id);
    expect(found?.id).toBe(created.id);
  });

  it('create with companyId links to a company in the same org', async () => {
    const company = await companies.create(orgId, { name: 'Linked Co' });
    const contact = await repo.create(orgId, userId, {
      firstName: 'Bob',
      companyId: company.id,
    });
    expect(contact.companyId).toBe(company.id);
  });

  it('findById returns null for an id in a different org', async () => {
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    const c = await repo.create(otherOrg!.id, userId, { firstName: 'Foreign' });
    expect(await repo.findById(orgId, c.id)).toBeNull();
  });

  it('list returns only the orgs rows, ordered by createdAt desc', async () => {
    await Promise.all([
      repo.create(orgId, userId, { firstName: `A-${Date.now()}` }),
      repo.create(orgId, userId, { firstName: `B-${Date.now()}` }),
    ]);
    const result = await repo.list(orgId, { limit: 50 });
    expect(result.items.every((r) => r.organizationId === orgId)).toBe(true);
  });

  it('update merges partial fields', async () => {
    const c = await repo.create(orgId, userId, { firstName: 'Patchable' });
    const updated = await repo.update(orgId, c.id, { title: 'CEO' });
    expect(updated?.title).toBe('CEO');
    expect(updated?.firstName).toBe('Patchable');
  });

  it('delete removes only when the id is in the org', async () => {
    const c = await repo.create(orgId, userId, { firstName: 'Deleteme' });
    expect(await repo.delete(orgId, c.id)).toBe(true);
    expect(await repo.findById(orgId, c.id)).toBeNull();
  });
});
