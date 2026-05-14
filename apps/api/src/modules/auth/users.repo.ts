import { eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import { normalizeEmail } from '../../lib/email.js';

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string | null;
}

export class UsersRepo {
  constructor(private readonly db: Database) {}

  async create(input: CreateUserInput): Promise<typeof schema.users.$inferSelect> {
    const [row] = await this.db
      .insert(schema.users)
      .values({
        email: normalizeEmail(input.email),
        name: input.name,
        passwordHash: input.passwordHash,
      })
      .returning();
    if (!row) throw new Error('Failed to insert user');
    return row;
  }

  async findByEmail(email: string): Promise<typeof schema.users.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalizeEmail(email)))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<typeof schema.users.$inferSelect | null> {
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return row ?? null;
  }
}
