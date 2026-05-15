import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database, schema } from '@dealflow/db';
import { SessionsRepo } from '../modules/auth/sessions.repo.js';
import { UsersRepo } from '../modules/auth/users.repo.js';
import type { Env } from '../env.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: typeof schema.users.$inferSelect | null;
    session: typeof schema.sessions.$inferSelect | null;
  }
}

export interface AuthContextOptions {
  db: Database;
  env: Env;
}

export async function registerAuthContext(
  app: FastifyInstance,
  opts: AuthContextOptions,
): Promise<void> {
  const sessions = new SessionsRepo(opts.db);
  const users = new UsersRepo(opts.db);

  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const cookieName = opts.env.SESSION_COOKIE_NAME;
    const raw = req.cookies[cookieName];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;

    const session = await sessions.findById(unsigned.value);
    if (!session) return;
    const user = await users.findById(session.userId);
    if (!user) return;

    req.session = session;
    req.user = user;
  });
}
