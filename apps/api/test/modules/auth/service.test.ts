import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../../helpers/postgres.js';
import { AuthService, type AuthError } from '../../../src/modules/auth/service.js';
import { OrgsRepo } from '../../../src/modules/auth/orgs.repo.js';
import { UsersRepo } from '../../../src/modules/auth/users.repo.js';
import { SessionsRepo } from '../../../src/modules/auth/sessions.repo.js';

describe('AuthService', () => {
  let testDb: TestDatabase;
  let svc: AuthService;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    svc = new AuthService({
      orgs: new OrgsRepo(testDb.db),
      users: new UsersRepo(testDb.db),
      sessions: new SessionsRepo(testDb.db),
      db: testDb.db,
      sessionDurationDays: 30,
    });
  }, 30_000);

  afterAll(() => testDb.stop());

  describe('signup (SaaS mode)', () => {
    it('creates org + user + owner membership + session', async () => {
      const result = await svc.signup({
        email: 'alice@example.com',
        password: 'StrongPa$$word1',
        name: 'Alice',
        orgName: 'Acme',
        deploymentMode: 'saas',
        userAgent: 'test',
        ip: '127.0.0.1',
        acceptLanguage: null,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.user.email).toBe('alice@example.com');
      expect(result.organization.name).toBe('Acme');
      expect(result.session.id).toMatch(/^[a-f0-9]{64}$/);
    });

    it('seeds the default pipeline with 6 stages', async () => {
      const result = await svc.signup({
        email: `seed-${Date.now()}@example.com`,
        password: 'StrongPa$$word1',
        name: 'Seed',
        orgName: 'SeedCo',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
        acceptLanguage: null,
      });
      if (!result.ok) throw new Error('signup failed');
      const pipelines = await testDb.db
        .select()
        .from(schema.pipelines)
        .where(eq(schema.pipelines.organizationId, result.organization.id));
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]!.name).toBe('Sales');
      expect(pipelines[0]!.isDefault).toBe(true);
      const stages = await testDb.db
        .select()
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.pipelineId, pipelines[0]!.id));
      expect(stages).toHaveLength(6);
    });

    it('rejects duplicate email', async () => {
      await svc.signup({
        email: 'dup@example.com',
        password: 'StrongPa$$word1',
        name: 'Dup',
        orgName: 'O',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
        acceptLanguage: null,
      });
      const second = await svc.signup({
        email: 'dup@example.com',
        password: 'StrongPa$$word1',
        name: 'Dup2',
        orgName: 'O2',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
        acceptLanguage: null,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect((second.error as AuthError).code).toBe('EMAIL_ALREADY_REGISTERED');
    });
  });

  describe('signup (self-host mode)', () => {
    it('allows the first signup, blocks the second', async () => {
      // Use a fresh test DB for this subgroup to isolate the count.
      const fresh = await startTestPostgres();
      try {
        const svcFresh = new AuthService({
          orgs: new OrgsRepo(fresh.db),
          users: new UsersRepo(fresh.db),
          sessions: new SessionsRepo(fresh.db),
          db: fresh.db,
          sessionDurationDays: 30,
        });
        const result = await svcFresh.signup({
          email: 'admin@example.com',
          password: 'StrongPa$$word1',
          name: 'Admin',
          orgName: 'My Company',
          deploymentMode: 'self-host',
          userAgent: null,
          ip: null,
          acceptLanguage: null,
        });
        expect(result.ok).toBe(true);

        // Second signup should now be blocked.
        const second = await svcFresh.signup({
          email: 'other@example.com',
          password: 'StrongPa$$word1',
          name: 'Other',
          orgName: 'X',
          deploymentMode: 'self-host',
          userAgent: null,
          ip: null,
          acceptLanguage: null,
        });
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.error.code).toBe('SELF_HOST_ALREADY_INITIALIZED');
      } finally {
        await fresh.stop();
      }
    }, 60_000);
  });

  describe('login', () => {
    it('returns ok + session for correct credentials', async () => {
      await svc.signup({
        email: 'login@example.com',
        password: 'CorrectPa$$word',
        name: 'L',
        orgName: 'L',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
        acceptLanguage: null,
      });
      const result = await svc.login({
        email: 'login@example.com',
        password: 'CorrectPa$$word',
        userAgent: null,
        ip: null,
      });
      expect(result.ok).toBe(true);
    });

    it('rejects wrong password', async () => {
      await svc.signup({
        email: 'wrong@example.com',
        password: 'RightPa$$word',
        name: 'W',
        orgName: 'W',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
        acceptLanguage: null,
      });
      const result = await svc.login({
        email: 'wrong@example.com',
        password: 'WrongPa$$word',
        userAgent: null,
        ip: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects unknown email with the same error as wrong password (no enumeration)', async () => {
      const result = await svc.login({
        email: 'nobody@nowhere.com',
        password: 'whatever',
        userAgent: null,
        ip: null,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('logout', () => {
    it('deletes the session', async () => {
      const signup = await svc.signup({
        email: 'logout@example.com',
        password: 'StrongPa$$word',
        name: 'L',
        orgName: 'L',
        deploymentMode: 'saas',
        userAgent: null,
        ip: null,
        acceptLanguage: null,
      });
      if (!signup.ok) throw new Error('signup failed');
      await svc.logout(signup.session.id);
      const sessions = new SessionsRepo(testDb.db);
      expect(await sessions.findById(signup.session.id)).toBeNull();
    });
  });
});
