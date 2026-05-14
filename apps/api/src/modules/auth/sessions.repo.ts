import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { generateSessionToken } from '../../lib/tokens.js';

export interface CreateSessionInput {
  userId: string;
  currentOrgId: string | null;
  expiresInDays: number;
  userAgent: string | null;
  ip: string | null;
}

export class SessionsRepo {
  constructor(private readonly db: Database) {}

  async create(input: CreateSessionInput): Promise<typeof schema.sessions.$inferSelect> {
    const id = generateSessionToken();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

    const [row] = await this.db
      .insert(schema.sessions)
      .values({
        id,
        userId: input.userId,
        currentOrgId: input.currentOrgId,
        expiresAt,
        userAgent: input.userAgent,
        ip: input.ip,
      })
      .returning();

    if (!row) throw new Error('Failed to insert session');
    return row;
  }

  async findById(id: string): Promise<typeof schema.sessions.$inferSelect | null> {
    const now = new Date();
    const [row] = await this.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, id), gte(schema.sessions.expiresAt, now)))
      .limit(1);
    return row ?? null;
  }

  async touch(id: string, expiresInDays: number): Promise<void> {
    const now = new Date();
    const newExpiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await this.db
      .update(schema.sessions)
      .set({ lastUsedAt: now, expiresAt: newExpiresAt })
      .where(eq(schema.sessions.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db.execute<{ count: number }>(
      sql`DELETE FROM sessions WHERE expires_at < NOW() RETURNING 1`,
    );
    return result.length;
  }
}
