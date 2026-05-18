import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

async function createContact(
  app: FastifyInstance,
  cookie: string,
  firstName: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    payload: { firstName },
    headers: { cookie },
  });
  return (res.json() as { contact: { id: string } }).contact.id;
}

async function createTask(
  app: FastifyInstance,
  cookie: string,
  contactId: string,
  body: string,
  dueAt?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/activities',
    payload: { kind: 'task', body, contactId, ...(dueAt ? { dueAt } : {}) },
    headers: { cookie },
  });
  return (res.json() as { activity: { id: string } }).activity.id;
}

describe('GET /api/v1/tasks', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  let overdueId: string;
  let todayId: string;
  let upcomingId: string;
  let doneId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Erin');

    overdueId = await createTask(app, cookie, contactId, 'overdue', '2020-01-01');
    const today = new Date().toISOString().slice(0, 10);
    todayId = await createTask(app, cookie, contactId, 'today', today);
    upcomingId = await createTask(app, cookie, contactId, 'upcoming', '2099-01-01');
    doneId = await createTask(app, cookie, contactId, 'done', '2099-01-02');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${doneId}`,
      payload: { status: 'done' },
      headers: { cookie },
    });

    // Notes should NOT appear in /tasks
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'a note', contactId },
      headers: { cookie },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('defaults to status=open (excludes notes and done tasks)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: { id: string; kind: string }[] }).items;
    expect(items.every((i) => i.kind === 'task')).toBe(true);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(overdueId);
    expect(ids).toContain(todayId);
    expect(ids).toContain(upcomingId);
    expect(ids).not.toContain(doneId);
  });

  it('status=done returns only completed tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?status=done',
      headers: { cookie },
    });
    const items = (res.json() as { items: { id: string }[] }).items;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(doneId);
    expect(ids).not.toContain(overdueId);
  });

  it('due=overdue returns only past-due open tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?due=overdue',
      headers: { cookie },
    });
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(overdueId);
    expect(ids).not.toContain(upcomingId);
    expect(ids).not.toContain(todayId);
  });

  it('due=today returns only tasks due today', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?due=today',
      headers: { cookie },
    });
    const ids = (res.json() as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(todayId);
    expect(ids).not.toContain(overdueId);
    expect(ids).not.toContain(upcomingId);
  });

  it('400 on unknown filter values', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks?due=junk',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
