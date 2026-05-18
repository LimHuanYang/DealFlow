import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Activities tenancy', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('Org B cannot read Org A activities', async () => {
    const a = await signupTestUser(app, { orgName: 'OrgA' });
    const b = await signupTestUser(app, { orgName: 'OrgB' });

    // Org A creates a contact + a note on that contact
    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Alice' },
      headers: { cookie: a.cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;

    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'private', contactId },
      headers: { cookie: a.cookie },
    });

    // Org B tries to list activities for Org A's contact id → 0 items
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/activities?contactId=${contactId}`,
      headers: { cookie: b.cookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as { items: unknown[] }).items.length).toBe(0);
  });

  it('Org B cannot PATCH or DELETE Org A activity', async () => {
    const a = await signupTestUser(app, { orgName: 'OrgC' });
    const b = await signupTestUser(app, { orgName: 'OrgD' });

    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Bob' },
      headers: { cookie: a.cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 'private task', contactId },
      headers: { cookie: a.cookie },
    });
    const activityId = (createRes.json() as { activity: { id: string } }).activity.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${activityId}`,
      payload: { body: 'edited by B' },
      headers: { cookie: b.cookie },
    });
    expect(patchRes.statusCode).toBe(404);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${activityId}`,
      headers: { cookie: b.cookie },
    });
    expect(delRes.statusCode).toBe(404);
  });

  it('Org B GET /api/v1/tasks does not see Org A tasks', async () => {
    const a = await signupTestUser(app, { orgName: 'OrgE' });
    const b = await signupTestUser(app, { orgName: 'OrgF' });

    const contactRes = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      payload: { firstName: 'Carl' },
      headers: { cookie: a.cookie },
    });
    const contactId = (contactRes.json() as { contact: { id: string } }).contact.id;

    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 'A only', contactId },
      headers: { cookie: a.cookie },
    });

    const bRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { cookie: b.cookie },
    });
    expect((bRes.json() as { items: { body: string }[] }).items.find((i) => i.body === 'A only')).toBeUndefined();
  });
});
