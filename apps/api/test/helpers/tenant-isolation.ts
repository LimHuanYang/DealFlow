import { expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signupTestUser } from './auth.js';

export interface TenantIsolationCase {
  /** Route under test, e.g. `(id) => '/api/v1/contacts/' + id`. */
  url: (resourceId: string) => string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Creates a resource in Org A and returns its id. */
  createResource: (
    app: FastifyInstance,
    cookie: string,
    orgId: string,
  ) => Promise<string>;
  /** Optional body for state-changing methods. */
  body?: Record<string, unknown> | string;
  /** Expected status code when Org B tries to access Org A's resource. */
  expectedStatus?: number;
}

/**
 * Registers a Vitest case asserting that a user from Organization B cannot
 * access a resource owned by Organization A via `endpoint`. Default is 404
 * (resource not found by row scoping) rather than 403 — we don't leak that
 * the resource exists.
 *
 * Use one per endpoint. By convention, every tenant-scoped route must have
 * exactly one of these. CI will enforce coverage in a later sub-plan via a
 * route-registry lint rule.
 */
export function assertTenantIsolation(
  name: string,
  getApp: () => FastifyInstance,
  testCase: TenantIsolationCase,
): void {
  test(`tenancy: ${name} — Org B cannot access Org A's resource`, async () => {
    const app = getApp();
    const { cookie: cookieA, orgId: orgAId } = await signupTestUser(app);
    const { cookie: cookieB } = await signupTestUser(app);

    const resourceId = await testCase.createResource(app, cookieA, orgAId);

    const res = await app.inject({
      method: testCase.method,
      url: testCase.url(resourceId),
      headers: { cookie: cookieB },
      payload: testCase.body,
    });

    expect(res.statusCode).toBe(testCase.expectedStatus ?? 404);
  });
}
