import { and, eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';

export interface CreatePipelineInput {
  name: string;
  isDefault: boolean;
}

export class PipelinesRepo {
  constructor(private readonly db: Database) {}

  async create(
    organizationId: string,
    input: CreatePipelineInput,
  ): Promise<typeof schema.pipelines.$inferSelect> {
    const [row] = await this.db
      .insert(schema.pipelines)
      .values({ organizationId, name: input.name, isDefault: input.isDefault })
      .returning();
    if (!row) throw new Error('Failed to insert pipeline');
    return row;
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<typeof schema.pipelines.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.pipelines)
      .where(and(eq(schema.pipelines.organizationId, organizationId), eq(schema.pipelines.id, id)))
      .limit(1);
    return row ?? null;
  }

  async listForOrg(organizationId: string): Promise<(typeof schema.pipelines.$inferSelect)[]> {
    return this.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.organizationId, organizationId));
  }
}
