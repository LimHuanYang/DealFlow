import { hashPassword, verifyPassword } from '../../lib/password.js';
import { isValidEmail, normalizeEmail } from '../../lib/email.js';
import type { OrgsRepo } from './orgs.repo.js';
import type { UsersRepo } from './users.repo.js';
import type { SessionsRepo } from './sessions.repo.js';
import type { Database, schema } from '@dealflow/db';
import { createDefaultPipeline } from '../pipelines/seed.js';
import { pickCurrencyFromAcceptLanguage } from '../../lib/locale-currency.js';

export type AuthErrorCode =
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_EMAIL'
  | 'PASSWORD_TOO_SHORT'
  | 'SELF_HOST_ALREADY_INITIALIZED';

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: AuthError };

export interface SignupInput {
  email: string;
  password: string;
  name: string;
  orgName: string;
  deploymentMode: 'saas' | 'self-host';
  userAgent: string | null;
  ip: string | null;
  acceptLanguage: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  userAgent: string | null;
  ip: string | null;
}

export interface SignupSuccess {
  user: typeof schema.users.$inferSelect;
  organization: typeof schema.organizations.$inferSelect;
  session: typeof schema.sessions.$inferSelect;
}

export interface LoginSuccess {
  user: typeof schema.users.$inferSelect;
  session: typeof schema.sessions.$inferSelect;
}

export interface AuthServiceDeps {
  orgs: OrgsRepo;
  users: UsersRepo;
  sessions: SessionsRepo;
  db: Database;
  sessionDurationDays: number;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async signup(input: SignupInput): Promise<Result<SignupSuccess>> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email))
      return {
        ok: false,
        error: { code: 'INVALID_EMAIL', message: 'Email is not a valid format' },
      };
    if (input.password.length < 12)
      return {
        ok: false,
        error: { code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 12 characters' },
      };

    if (input.deploymentMode === 'self-host') {
      const existing = await this.deps.orgs.countAll();
      if (existing > 0) {
        return {
          ok: false,
          error: {
            code: 'SELF_HOST_ALREADY_INITIALIZED',
            message:
              'This DealFlow instance is already initialized. Ask the owner for an invitation.',
          },
        };
      }
    }

    const dup = await this.deps.users.findByEmail(email);
    if (dup)
      return {
        ok: false,
        error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email is already in use' },
      };

    const passwordHash = await hashPassword(input.password);
    const user = await this.deps.users.create({ email, name: input.name, passwordHash });
    const slug = slugify(input.orgName) + '-' + user.id.slice(0, 8);
    const defaultCurrency = pickCurrencyFromAcceptLanguage(input.acceptLanguage);
    const organization = await this.deps.orgs.create({
      name: input.orgName,
      slug,
      defaultCurrency,
    });
    await this.deps.orgs.addMember(organization.id, user.id, 'owner');

    // Seed default pipeline so the new owner lands on a usable kanban.
    await createDefaultPipeline(this.deps.db, organization.id);

    const session = await this.deps.sessions.create({
      userId: user.id,
      currentOrgId: organization.id,
      expiresInDays: this.deps.sessionDurationDays,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return { ok: true, user, organization, session };
  }

  async login(input: LoginInput): Promise<Result<LoginSuccess>> {
    const email = normalizeEmail(input.email);
    const user = await this.deps.users.findByEmail(email);

    // Use a constant-time-ish check by always running argon2 verify against
    // either a real hash or a dummy one, so timing doesn't leak enumeration.
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$dummydummydummydummydummydumm$DG5kRtoNkUg7HxF0mIBcMjsTQrXrjBzMlGZVDJ8MnDM';
    const hash = user?.passwordHash ?? dummyHash;
    const valid = await verifyPassword(hash, input.password);

    if (!user || !valid)
      return {
        ok: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      };

    // Auto-select the user's first org membership as the current org. This
    // closes the Sub-Plan 2a gap where login-only users had session.currentOrgId
    // = null and were blocked by `requireOrg` on every tenant-scoped endpoint.
    // Full multi-org switching UI lands in Sub-Plan 2c.
    const currentOrgId = await this.deps.orgs.findFirstOrgIdForUser(user.id);
    const session = await this.deps.sessions.create({
      userId: user.id,
      currentOrgId,
      expiresInDays: this.deps.sessionDurationDays,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return { ok: true, user, session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.sessions.delete(sessionId);
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
