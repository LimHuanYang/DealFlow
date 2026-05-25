import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';
import { schema } from '@dealflow/db';

interface ActivityBody {
  activity: { id: string; kind: string; body: string; contactId: string | null };
}

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
  if (res.statusCode !== 201) throw new Error(`contact create failed: ${res.body}`);
  return (res.json() as { contact: { id: string } }).contact.id;
}

describe('POST /api/v1/activities', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Alice');
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'x', contactId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a note on a contact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'First note', contactId },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as ActivityBody;
    expect(body.activity.kind).toBe('note');
    expect(body.activity.body).toBe('First note');
    expect(body.activity.contactId).toBe(contactId);
  });

  it('400 when no parent is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when two parents are provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        kind: 'note',
        body: 'x',
        contactId,
        companyId: '00000000-0000-0000-0000-000000000001',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404 when parent contact does not exist in this org', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: {
        kind: 'note',
        body: 'x',
        contactId: '00000000-0000-0000-0000-000000000001',
      },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/v1/activities?contactId=:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Bob');

    // Seed three activities (two notes + one task) on the contact
    for (const body of ['n1', 'n2']) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/activities',
        payload: { kind: 'note', body, contactId },
        headers: { cookie },
      });
    }
    await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 't1', contactId },
      headers: { cookie },
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('returns activities ordered newest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities?contactId=${contactId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { body: string; createdAt: string }[] };
    expect(body.items.length).toBe(3);
    // newest first
    expect(body.items[0]!.body).toBe('t1');
    expect(body.items[2]!.body).toBe('n1');
  });

  it('400 when no parent filter given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/activities',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 when two parent filters given', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/activities?contactId=${contactId}&dealId=${contactId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /api/v1/activities/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;
  let noteId: string;
  let taskId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Carol');

    const noteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'before', contactId },
      headers: { cookie },
    });
    noteId = (noteRes.json() as ActivityBody).activity.id;

    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'task', body: 'do it', contactId },
      headers: { cookie },
    });
    taskId = (taskRes.json() as ActivityBody).activity.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('edits a note body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${noteId}`,
      payload: { body: 'after' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ActivityBody).activity.body).toBe('after');
  });

  it('marks a task done and stamps completedAt', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${taskId}`,
      payload: { status: 'done' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      activity: { status: string; completedAt: string | null };
    };
    expect(body.activity.status).toBe('done');
    expect(body.activity.completedAt).not.toBeNull();
  });

  it('404 on unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/activities/00000000-0000-0000-0000-000000000001',
      payload: { body: 'x' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 on bad status enum value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/activities/${taskId}`,
      payload: { status: 'archived' },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/v1/activities/:id', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;
  let contactId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    app = await buildTestApp({ db: testDb.db });
    ({ cookie } = await signupTestUser(app));
    contactId = await createContact(app, cookie, 'Dan');
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await testDb.stop();
  });

  it('204 on hit, 404 on miss', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/activities',
      payload: { kind: 'note', body: 'temp', contactId },
      headers: { cookie },
    });
    const id = (create.json() as ActivityBody).activity.id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/activities/${id}`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(404);
  });
});

describe('Activities customFields', () => {
  it('PATCH a note uses note custom field definitions', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    try {
      const { cookie } = await signupTestUser(app);
      const def = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields',
        headers: { cookie },
        payload: { entityType: 'note', name: 'Outcome', type: 'text' },
      });
      const noteFieldId = def.json().id;

      const contact = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        headers: { cookie },
        payload: { firstName: 'X' },
      });
      const note = await app.inject({
        method: 'POST',
        url: '/api/v1/activities',
        headers: { cookie },
        payload: { kind: 'note', body: 'Met today', contactId: contact.json().contact.id },
      });
      const id = note.json().activity.id;

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/v1/activities/${id}`,
        headers: { cookie },
        payload: { customFields: { [noteFieldId]: 'Qualified' } },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().activity.customFields).toEqual({ [noteFieldId]: 'Qualified' });
    } finally {
      await app.close();
      await testDb.stop();
    }
  }, 30_000);

  it('a task field is invalid on a note', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    try {
      const { cookie } = await signupTestUser(app);
      const def = await app.inject({
        method: 'POST',
        url: '/api/v1/custom-fields',
        headers: { cookie },
        payload: { entityType: 'task', name: 'Effort', type: 'number' },
      });
      const taskFieldId = def.json().id;

      const contact = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        headers: { cookie },
        payload: { firstName: 'X' },
      });
      const note = await app.inject({
        method: 'POST',
        url: '/api/v1/activities',
        headers: { cookie },
        payload: { kind: 'note', body: 'n', contactId: contact.json().contact.id },
      });
      const id = note.json().activity.id;
      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/v1/activities/${id}`,
        headers: { cookie },
        payload: { customFields: { [taskFieldId]: 3 } },
      });
      expect(updated.statusCode).toBe(400);
    } finally {
      await app.close();
      await testDb.stop();
    }
  }, 30_000);

  it('GET /api/v1/activities/:id returns the activity (new endpoint)', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    try {
      const { cookie } = await signupTestUser(app);
      const contact = await app.inject({
        method: 'POST',
        url: '/api/v1/contacts',
        headers: { cookie },
        payload: { firstName: 'X' },
      });
      const note = await app.inject({
        method: 'POST',
        url: '/api/v1/activities',
        headers: { cookie },
        payload: { kind: 'note', body: 'one', contactId: contact.json().contact.id },
      });
      const id = note.json().activity.id;
      const got = await app.inject({
        method: 'GET',
        url: `/api/v1/activities/${id}`,
        headers: { cookie },
      });
      expect(got.statusCode).toBe(200);
      expect(got.json().activity.id).toBe(id);
      expect(got.json().activity.body).toBe('one');
    } finally {
      await app.close();
      await testDb.stop();
    }
  }, 30_000);

  it('GET /api/v1/activities/:id 404s for unknown id', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    try {
      const { cookie } = await signupTestUser(app);
      const got = await app.inject({
        method: 'GET',
        url: '/api/v1/activities/00000000-0000-0000-0000-000000000000',
        headers: { cookie },
      });
      expect(got.statusCode).toBe(404);
    } finally {
      await app.close();
      await testDb.stop();
    }
  }, 30_000);
});

describe('GET /api/v1/activities/:id/events', () => {
  it('returns events ordered by most recent first', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    try {
      const { cookie, userId, orgId } = await signupTestUser(app);
      const [contact] = await testDb.db
        .insert(schema.contacts)
        .values({ organizationId: orgId, firstName: 'X' })
        .returning();
      const [activity] = await testDb.db
        .insert(schema.activities)
        .values({
          organizationId: orgId,
          ownerUserId: userId,
          kind: 'email',
          body: 'b',
          contactId: contact!.id,
        })
        .returning();
      // Insert 3 events with deliberately spaced timestamps.
      await testDb.db.insert(schema.emailEvents).values([
        {
          organizationId: orgId,
          activityId: activity!.id,
          eventType: 'sent',
          occurredAt: new Date('2026-05-25T10:00:00Z'),
        },
        {
          organizationId: orgId,
          activityId: activity!.id,
          eventType: 'open',
          occurredAt: new Date('2026-05-25T10:05:00Z'),
        },
        {
          organizationId: orgId,
          activityId: activity!.id,
          eventType: 'click',
          url: 'https://a.com',
          occurredAt: new Date('2026-05-25T10:10:00Z'),
        },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/activities/${activity!.id}/events`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items).toHaveLength(3);
      expect(items[0].eventType).toBe('click');
      expect(items[0].url).toBe('https://a.com');
      expect(items[items.length - 1].eventType).toBe('sent');
    } finally {
      await app.close();
      await testDb.stop();
    }
  }, 30_000);

  it('404s when activity belongs to another org (tenant isolation)', async () => {
    const testDb = await startTestPostgres();
    const app = await buildTestApp({ db: testDb.db });
    try {
      const a = await signupTestUser(app);
      const b = await signupTestUser(app);
      const [contact] = await testDb.db
        .insert(schema.contacts)
        .values({ organizationId: a.orgId, firstName: 'X' })
        .returning();
      const [activity] = await testDb.db
        .insert(schema.activities)
        .values({
          organizationId: a.orgId,
          ownerUserId: a.userId,
          kind: 'email',
          body: 'b',
          contactId: contact!.id,
        })
        .returning();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/activities/${activity!.id}/events`,
        headers: { cookie: b.cookie },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
      await testDb.stop();
    }
  }, 30_000);
});
