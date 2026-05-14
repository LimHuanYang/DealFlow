import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.js';

export async function registerCookie(app: FastifyInstance, env: Env): Promise<void> {
  await app.register(cookie, {
    secret: env.SESSION_COOKIE_SECRET, // used by app.signCookie / app.unsignCookie
    parseOptions: {
      // Cookies set by us default to: HttpOnly, SameSite=Lax, Secure in production.
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
    },
  });
}
