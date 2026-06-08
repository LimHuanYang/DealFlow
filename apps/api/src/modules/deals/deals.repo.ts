import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type { CreateDealInput, UpdateDealInput } from '@dealflow/shared';

export interface ListDealsQuery {
  pipelineId?: string;
  status?: 'open' | 'won' | 'lost';
}

export class DealsRepo {
  constructor(private readonly db: Database) {}

  async create(
    organizationId: string,
    ownerUserId: string,
    input: CreateDealInput,
  ): Promise<typeof schema.deals.$inferSelect> {
    // Place at end of target column: max(position_in_stage) + 1.
    const [maxRow] = await this.db
      .select({
        max: sql<number>`COALESCE(MAX(${schema.deals.positionInStage}), 0)`,
      })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.organizationId, organizationId),
          eq(schema.deals.stageId, input.stageId),
        ),
      );
    const positionInStage = (maxRow?.max ?? 0) + 1;

    const [row] = await this.db
      .insert(schema.deals)
      .values({
        organizationId,
        ownerUserId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        name: input.name,
        value: input.value != null ? String(input.value) : null,
        currency: input.currency ?? 'USD',
        primaryContactId: input.primaryContactId ?? null,
        companyId: input.companyId ?? null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        positionInStage,
        customFields: input.customFields ?? {},
      })
      .returning();
    if (!row) throw new Error('Failed to insert deal');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.deals.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.id, id)))
      .limit(1);
    return row ?? null;
  }

  async list(
    organizationId: string,
    query: ListDealsQuery,
  ): Promise<(typeof schema.deals.$inferSelect)[]> {
    const conds = [eq(schema.deals.organizationId, organizationId)];
    if (query.pipelineId) conds.push(eq(schema.deals.pipelineId, query.pipelineId));
    if (query.status) conds.push(eq(schema.deals.status, query.status));
    return this.db
      .select()
      .from(schema.deals)
      .where(and(...conds))
      .orderBy(
        asc(schema.deals.stageId),
        asc(schema.deals.positionInStage),
        desc(schema.deals.createdAt),
      );
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateDealInput,
  ): Promise<typeof schema.deals.$inferSelect | null> {
    const next: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) next['name'] = patch.name;
    if (patch.pipelineId !== undefined) next['pipelineId'] = patch.pipelineId;
    if (patch.stageId !== undefined) next['stageId'] = patch.stageId;
    if (patch.value !== undefined) next['value'] = patch.value == null ? null : String(patch.value);
    if (patch.currency !== undefined) next['currency'] = patch.currency;
    if (patch.primaryContactId !== undefined) next['primaryContactId'] = patch.primaryContactId;
    if (patch.companyId !== undefined) next['companyId'] = patch.companyId;
    if (patch.expectedCloseDate !== undefined) next['expectedCloseDate'] = patch.expectedCloseDate;
    if (patch.ownerUserId !== undefined) next['ownerUserId'] = patch.ownerUserId;
    if (patch.customFields !== undefined) next['customFields'] = patch.customFields;

    const [row] = await this.db
      .update(schema.deals)
      .set(next)
      .where(and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.id, id)))
      .returning();
    return row ?? null;
  }

  async moveToStage(
    organizationId: string,
    id: string,
    stageId: string,
    positionInStage: number,
  ): Promise<typeof schema.deals.$inferSelect | null> {
    // Resolve target stage's terminal-status flags to compute deal status.
    const [stage] = await this.db
      .select({
        id: schema.pipelineStages.id,
        isWon: schema.pipelineStages.isWon,
        isLost: schema.pipelineStages.isLost,
      })
      .from(schema.pipelineStages)
      .where(
        and(
          eq(schema.pipelineStages.id, stageId),
          eq(schema.pipelineStages.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!stage) return null;

    const now = new Date();
    const next: Record<string, unknown> = {
      stageId,
      positionInStage,
      updatedAt: now,
    };
    if (stage.isWon) {
      next['status'] = 'won';
      next['closedAt'] = now;
    } else if (stage.isLost) {
      next['status'] = 'lost';
      next['closedAt'] = now;
    } else {
      next['status'] = 'open';
      next['closedAt'] = null;
    }

    const [row] = await this.db
      .update(schema.deals)
      .set(next)
      .where(and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.id, id)))
      .returning();
    return row ?? null;
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    const result = await this.db
      .delete(schema.deals)
      .where(and(eq(schema.deals.organizationId, organizationId), eq(schema.deals.id, id)))
      .returning({ id: schema.deals.id });
    return result.length > 0;
  }
}
