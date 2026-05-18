import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@dealflow/db';
import type { Env } from '../../env.js';
import { ERROR_CODES } from '@dealflow/shared';
import { AuthService, type AuthErrorCode } from './service.js';
import { OrgsRepo } from './orgs.repo.js';
import { UsersRepo } from './users.repo.js';
import { SessionsRepo } from './sessions.repo.js';

const signupBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(12).max(200),
  name: z.string().min(1).max(120),
  orgName: z.string().min(1).max(120),
});

const loginBodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

const ERROR_TO_HTTP: Record<AuthErrorCode, number> = {
  EMAIL_ALREADY_REGISTERED: 409,
  INVALID_CREDENTIALS: 401,
  INVALID_EMAIL: 400,
  PASSWORD_TOO_SHORT: 400,
  SELF_HOST_ALREADY_INITIALIZED: 403,
};

export interface AuthRoutesDeps {
  db: Database;
  env: Env;
}

function pickPublic(user: {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  avatarUrl: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt,
    avatarUrl: user.avatarUrl,
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRoutesDeps,
): Promise<void> {
  const svc = new AuthService({
    orgs: new OrgsRepo(deps.db),
    users: new UsersRepo(deps.db),
    sessions: new SessionsRepo(deps.db),
    db: deps.db,
    sessionDurationDays: deps.env.SESSION_DURATION_DAYS,
  });

  app.post('/api/v1/auth/signup', async (req, reply) => {
    const parsed = signupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid signup payload',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const result = await svc.signup({
      ...parsed.data,
      deploymentMode: deps.env.DEPLOYMENT_MODE,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
      acceptLanguage: req.headers['accept-language'] ?? null,
    });

    if (!result.ok) {
      return reply
        .status(ERROR_TO_HTTP[result.error.code])
        .send({ error: { code: result.error.code, message: result.error.message } });
    }

    const signed = reply.signCookie(result.session.id);
    reply.setCookie(deps.env.SESSION_COOKIE_NAME, signed);

    return reply.status(201).send({
      user: pickPublic(result.user),
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
      },
    });
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid login payload' },
      });
    }

    const result = await svc.login({
      email: parsed.data.email,
      password: parsed.data.password,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });

    if (!result.ok) {
      return reply
        .status(ERROR_TO_HTTP[result.error.code])
        .send({ error: { code: result.error.code, message: result.error.message } });
    }

    const signed = reply.signCookie(result.session.id);
    reply.setCookie(deps.env.SESSION_COOKIE_NAME, signed);

    return reply.send({ user: pickPublic(result.user) });
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.session) {
      await svc.logout(req.session.id);
    }
    reply.clearCookie(deps.env.SESSION_COOKIE_NAME);
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    if (!req.user) {
      return reply
        .status(401)
        .send({ error: { code: ERROR_CODES.UNAUTHORIZED, message: 'Not authenticated' } });
    }
    return reply.send({ user: pickPublic(req.user) });
  });
}
