import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { CreateCompanyInput, UpdateCompanyInput } from '@dealflow/shared';

export interface ListCompaniesQuery {
  cursor?: string | undefined;
  limit?: number;
  q?: string | undefined;
}

export class CompaniesRepo {
  constructor(private readonly db: Database) {}

  async create(
    organizationId: string,
    input: CreateCompanyInput,
  ): Promise<typeof schema.companies.$inferSelect> {
    const [row] = await this.db
      .insert(schema.companies)
      .values({
        organizationId,
        name: input.name,
        domain: input.domain ?? null,
        industry: input.industry ?? null,
        size: input.size ?? null,
        website: input.website ?? null,
        description: input.description ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to insert company');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.companies.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.organizationId, organizationId), eq(schema.companies.id, id)))
      .limit(1);
    return row ?? null;
  }

  async list(
    organizationId: string,
    query: ListCompaniesQuery,
  ): Promise<{
    items: (typeof schema.companies.$inferSelect)[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? 50;
    const conds = [eq(schema.companies.organizationId, organizationId)];
    if (query.cursor) {
      const cursorDate = new Date(query.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        conds.push(lt(schema.companies.createdAt, cursorDate));
      }
    }
    if (query.q) {
      conds.push(sql`${schema.companies.name} ILIKE ${'%' + query.q + '%'}`);
    }
    const rows = await this.db
      .select()
      .from(schema.companies)
      .where(and(...conds))
      .orderBy(desc(schema.companies.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null;
    return { items, nextCursor };
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateCompanyInput,
  ): Promise<typeof schema.companies.$inferSelect | null> {
    const [row] = await this.db
      .update(schema.companies)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.companies.organizationId, organizationId), eq(schema.companies.id, id)))
      .returning();
    return row ?? null;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.companies)
      .where(and(eq(schema.companies.organizationId, organizationId), eq(schema.companies.id, id)))
      .returning({ id: schema.companies.id });
    return result.length > 0;
  }
}
