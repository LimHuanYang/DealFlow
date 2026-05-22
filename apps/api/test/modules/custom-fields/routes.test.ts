import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { buildTestApp } from '../../helpers/build-app.js';
import { signupTestUser } from '../../helpers/auth.js';

describe('Custom fields CRUD', () => {
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

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/custom-fields?entity=contact' });
    expect(res.statusCode).toBe(401);
  });

  it('round-trips a definition: create → list → patch → delete', async () => {
    const { cookie } = await signupTestUser(app);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'contact', name: 'Lead Source', type: 'select', options: { values: [{ key: 'web', label: 'Web' }] } },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.entityType).toBe('contact');
    expect(created.name).toBe('Lead Source');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=contact',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/custom-fields/${created.id}`,
      headers: { cookie },
      payload: { name: 'Source', required: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Source');
    expect(patch.json().required).toBe(true);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/custom-fields/${created.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const listEmpty = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=contact',
      headers: { cookie },
    });
    expect(listEmpty.json()).toEqual([]);
  });

  it('rejects duplicate (org, entityType, name)', async () => {
    const { cookie } = await signupTestUser(app);
    const payload = { entityType: 'deal' as const, name: 'Source', type: 'text' as const };
    const a = await app.inject({ method: 'POST', url: '/api/v1/custom-fields', headers: { cookie }, payload });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({ method: 'POST', url: '/api/v1/custom-fields', headers: { cookie }, payload });
    expect(b.statusCode).toBe(409);
  });

  it('enforces tenant isolation: orgA cannot list orgB definitions', async () => {
    const a = await signupTestUser(app);
    const b = await signupTestUser(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie: a.cookie },
      payload: { entityType: 'company', name: 'Tier', type: 'text' },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields?entity=company',
      headers: { cookie: b.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
  });

  it('rejects PATCH that tries to change type', async () => {
    const { cookie } = await signupTestUser(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields',
      headers: { cookie },
      payload: { entityType: 'note', name: 'Outcome', type: 'select', options: { values: [{ key: 'a', label: 'A' }] } },
    });
    const id = create.json().id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/custom-fields/${id}`,
      headers: { cookie },
      // @ts-expect-error type is intentionally not in the schema
      payload: { type: 'text' },
    });
    // Either 400 (Zod strips/rejects) or 200 + type unchanged. The route must
    // not allow type to mutate.
    if (patch.statusCode === 200) {
      expect(patch.json().type).toBe('select');
    } else {
      expect(patch.statusCode).toBe(400);
    }
  });
});
