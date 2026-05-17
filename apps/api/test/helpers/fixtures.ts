import type { FastifyInstance } from 'fastify';
import { signupTestUser } from './auth.js';
import type { PublicCompany, PublicContact } from '@dealflow/shared';

/**
 * Create a signed-up user and a company in their org. Returns the auth
 * cookie and the company so tests can build on top.
 */
export async function createTestCompany(
  app: FastifyInstance,
  overrides: Partial<{
    email: string;
    name: string;
    orgName: string;
    companyName: string;
    domain: string;
  }> = {},
): Promise<{ cookie: string; orgId: string; userId: string; company: PublicCompany }> {
  const auth = await signupTestUser(app, {
    email: overrides.email,
    name: overrides.name,
    orgName: overrides.orgName,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/companies',
    headers: { cookie: auth.cookie },
    payload: {
      name: overrides.companyName ?? `Acme ${Date.now()}`,
      domain: overrides.domain,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createTestCompany failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json<{ company: PublicCompany }>();
  return { cookie: auth.cookie, orgId: auth.orgId, userId: auth.userId, company: body.company };
}

/** Same shape for contacts. */
export async function createTestContact(
  app: FastifyInstance,
  cookie: string,
  overrides: Partial<{ firstName: string; lastName: string; email: string; companyId: string }> = {},
): Promise<PublicContact> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/contacts',
    headers: { cookie },
    payload: {
      firstName: overrides.firstName ?? `First-${Date.now()}`,
      lastName: overrides.lastName ?? 'Doe',
      email: overrides.email,
      companyId: overrides.companyId,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createTestContact failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ contact: PublicContact }>().contact;
}
