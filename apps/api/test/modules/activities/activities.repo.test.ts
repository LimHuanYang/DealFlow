import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { ActivitiesRepo } from '../../../src/modules/activities/activities.repo.js';
import { ContactsRepo } from '../../../src/modules/contacts/contacts.repo.js';

describe('ActivitiesRepo', () => {
  let testDb: TestDatabase;
  let repo: ActivitiesRepo;
  let contacts: ContactsRepo;
  let orgId: string;
  let userId: string;
  let contactId: string;

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

    repo = new ActivitiesRepo(testDb.db);
    contacts = new ContactsRepo(testDb.db);

    const c = await contacts.create(orgId, { firstName: 'Alice' });
    contactId = c.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('creates a note attached to a contact', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'Met at conference',
      contactId,
    });
    expect(note.kind).toBe('note');
    expect(note.body).toBe('Met at conference');
    expect(note.contactId).toBe(contactId);
    expect(note.status).toBeNull();
    expect(note.dueAt).toBeNull();
    expect(note.ownerUserId).toBe(userId);
  });

  it('creates a task with status=open by default', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Follow up',
      contactId,
    });
    expect(task.kind).toBe('task');
    expect(task.status).toBe('open');
    expect(task.dueAt).toBeNull();
  });

  it('creates a task with a YYYY-MM-DD dueAt', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Send proposal',
      contactId,
      dueAt: '2026-06-15',
    });
    expect(task.dueAt).toBeInstanceOf(Date);
    expect(task.dueAt!.toISOString().startsWith('2026-06-15')).toBe(true);
  });

  it('listForParent returns activities for a contact, newest first', async () => {
    const list = await repo.listForParent(orgId, { contactId });
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        list[i]!.createdAt.getTime(),
      );
    }
  });

  it('findById returns null for a different org', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'xx',
      contactId,
    });
    const [otherOrg] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Other', slug: `other-${Date.now()}` })
      .returning();
    expect(await repo.findById(otherOrg!.id, note.id)).toBeNull();
  });

  it('update merges body and bumps updatedAt', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'before',
      contactId,
    });
    const updated = await repo.update(orgId, note.id, { body: 'after' });
    expect(updated?.body).toBe('after');
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(note.updatedAt.getTime());
  });

  it('marking a task done stamps completedAt automatically', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Close it',
      contactId,
    });
    const done = await repo.update(orgId, task.id, { status: 'done' });
    expect(done?.status).toBe('done');
    expect(done?.completedAt).toBeInstanceOf(Date);
  });

  it('marking a task back to open clears completedAt', async () => {
    const task = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'Reopen me',
      contactId,
    });
    await repo.update(orgId, task.id, { status: 'done' });
    const reopened = await repo.update(orgId, task.id, { status: 'open' });
    expect(reopened?.status).toBe('open');
    expect(reopened?.completedAt).toBeNull();
  });

  it('delete returns true on hit, false on miss', async () => {
    const note = await repo.create(orgId, userId, {
      kind: 'note',
      body: 'temp',
      contactId,
    });
    expect(await repo.delete(orgId, note.id)).toBe(true);
    expect(await repo.delete(orgId, note.id)).toBe(false);
  });

  it('listTasks filters by status (open vs done)', async () => {
    const t1 = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'open-1',
      contactId,
    });
    const t2 = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'done-1',
      contactId,
    });
    await repo.update(orgId, t2.id, { status: 'done' });

    const open = await repo.listTasks(orgId, { status: 'open', due: 'all' });
    const done = await repo.listTasks(orgId, { status: 'done', due: 'all' });
    expect(open.find((t) => t.id === t1.id)).toBeDefined();
    expect(open.find((t) => t.id === t2.id)).toBeUndefined();
    expect(done.find((t) => t.id === t2.id)).toBeDefined();
  });

  it('listTasks filters by due=overdue', async () => {
    const overdueTask = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'overdue',
      contactId,
      dueAt: '2020-01-01',
    });
    const futureTask = await repo.create(orgId, userId, {
      kind: 'task',
      body: 'future',
      contactId,
      dueAt: '2099-01-01',
    });
    const overdue = await repo.listTasks(orgId, { status: 'open', due: 'overdue' });
    expect(overdue.find((t) => t.id === overdueTask.id)).toBeDefined();
    expect(overdue.find((t) => t.id === futureTask.id)).toBeUndefined();
  });
});
