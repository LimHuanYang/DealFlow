import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';

export interface NewStageInput {
  name: string;
  orderIndex: number;
  winProbability: number | null;
  isWon: boolean;
  isLost: boolean;
}

export class PipelineStagesRepo {
  constructor(private readonly db: Database) {}

  async createMany(
    organizationId: string,
    pipelineId: string,
    rows: NewStageInput[],
  ): Promise<(typeof schema.pipelineStages.$inferSelect)[]> {
    if (rows.length === 0) return [];
    const values = rows.map((r) => ({
      organizationId,
      pipelineId,
      name: r.name,
      orderIndex: r.orderIndex,
      winProbability: r.winProbability,
      isWon: r.isWon,
      isLost: r.isLost,
    }));
    return this.db.insert(schema.pipelineStages).values(values).returning();
  }

  async listForPipeline(
    organizationId: string,
    pipelineId: string,
  ): Promise<(typeof schema.pipelineStages.$inferSelect)[]> {
    return this.db
      .select()
      .from(schema.pipelineStages)
      .where(
        and(
          eq(schema.pipelineStages.organizationId, organizationId),
          eq(schema.pipelineStages.pipelineId, pipelineId),
        ),
      )
      .orderBy(asc(schema.pipelineStages.orderIndex));
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.pipelineStages.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.pipelineStages)
      .where(
        and(
          eq(schema.pipelineStages.organizationId, organizationId),
          eq(schema.pipelineStages.id, id),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
