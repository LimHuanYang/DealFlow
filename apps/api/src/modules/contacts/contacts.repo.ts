import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { CreateContactInput, UpdateContactInput } from '@dealflow/shared';

export interface ListContactsQuery {
  cursor?: string | undefined;
  limit?: number;
  q?: string | undefined;
  companyId?: string | undefined;
}

export class ContactsRepo {
  constructor(private readonly db: Database) {}

  async create(
    organizationId: string,
    input: CreateContactInput,
  ): Promise<typeof schema.contacts.$inferSelect> {
    const [row] = await this.db
      .insert(schema.contacts)
      .values({
        organizationId,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        title: input.title ?? null,
        companyId: input.companyId ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert contact');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.contacts.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)))
      .limit(1);
    return row ?? null;
  }

  async list(
    organizationId: string,
    query: ListContactsQuery,
  ): Promise<{
    items: (typeof schema.contacts.$inferSelect)[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? 50;
    const conds = [eq(schema.contacts.organizationId, organizationId)];
    if (query.cursor) {
      const cursorDate = new Date(query.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        conds.push(lt(schema.contacts.createdAt, cursorDate));
      }
    }
    if (query.companyId) {
      conds.push(eq(schema.contacts.companyId, query.companyId));
    }
    if (query.q) {
      const pattern = '%' + query.q + '%';
      const orClause = or(
        sql`${schema.contacts.firstName} ILIKE ${pattern}`,
        sql`${schema.contacts.lastName} ILIKE ${pattern}`,
        sql`${schema.contacts.email} ILIKE ${pattern}`,
      );
      if (orClause) conds.push(orClause);
    }
    const rows = await this.db
      .select()
      .from(schema.contacts)
      .where(and(...conds))
      .orderBy(desc(schema.contacts.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateContactInput,
  ): Promise<typeof schema.contacts.$inferSelect | null> {
    const [row] = await this.db
      .update(schema.contacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)))
      .returning();
    return row ?? null;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, organizationId), eq(schema.contacts.id, id)))
      .returning({ id: schema.contacts.id });
    return result.length > 0;
  }
}
