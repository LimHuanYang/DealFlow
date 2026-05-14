import csrfProtection from '@fastify/csrf-protection';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

/**
 * Double-submit CSRF using @fastify/csrf-protection:
 * - GET /auth/csrf returns a token and sets a non-HttpOnly cookie.
 * - State-changing methods must include the token in `X-CSRF-Token` header
 *   matching the cookie. We attach the verification hook in route registration
 *   (see auth/routes.ts) rather than globally, so the public `/health` endpoint
 *   remains open.
 */
export async function registerCsrf(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(csrfProtection, {
    sessionPlugin: '@fastify/cookie',
    cookieKey: 'dealflow_csrf',
    cookieOpts: {
      httpOnly: false, // double-submit: the JS frontend needs to read it
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
    },
    getToken: (req) => (req.headers['x-csrf-token'] as string | undefined) ?? '',
  });

  // CSRF_SECRET is reserved for future use (e.g., custom token signing).
  // Currently @fastify/csrf-protection signs via @fastify/cookie's secret.
  void env.CSRF_SECRET;
}
