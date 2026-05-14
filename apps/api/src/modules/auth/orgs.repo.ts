import { eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { OrgRole } from '@dealflow/db/schema';

export interface CreateOrgInput {
  name: string;
  slug: string;
}

export class OrgsRepo {
  constructor(private readonly db: Database) {}

  async create(input: CreateOrgInput): Promise<typeof schema.organizations.$inferSelect> {
    const [row] = await this.db
      .insert(schema.organizations)
      .values({ name: input.name, slug: input.slug })
      .returning();
    if (!row) throw new Error('Failed to insert organization');
    return row;
  }

  async findById(id: string): Promise<typeof schema.organizations.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);
    return row ?? null;
  }

  async countAll(): Promise<number> {
    const [row] = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM organizations`,
    );
    return row?.count ?? 0;
  }

  async addMember(organizationId: string, userId: string, role: OrgRole): Promise<void> {
    await this.db.insert(schema.orgMembers).values({ organizationId, userId, role });
  }
}
