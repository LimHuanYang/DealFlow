import type { FastifyInstance } from 'fastify';

/**
 * Hits POST /api/v1/auth/signup and returns the session cookie string for
 * subsequent authenticated requests in the same test.
 */
export async function signupTestUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; name: string; orgName: string }> = {},
): Promise<{ cookie: string; userId: string; orgId: string }> {
  const email =
    overrides.email ?? `u${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = overrides.password ?? 'CorrectHorseBatteryStaple1';
  const name = overrides.name ?? 'Test User';
  const orgName = overrides.orgName ?? 'Test Org';

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { email, password, name, orgName },
  });
  if (res.statusCode !== 201) {
    throw new Error(`Signup failed: ${res.statusCode} ${res.body}`);
  }

  const setCookie = res.cookies.find((c) => c.name === 'dealflow_session');
  if (!setCookie) throw new Error('No session cookie in signup response');

  const body = res.json() as { user: { id: string }; organization: { id: string } };
  return {
    cookie: `${setCookie.name}=${setCookie.value}`,
    userId: body.user.id,
    orgId: body.organization.id,
  };
}
