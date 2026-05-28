import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';

export interface NewAttachmentInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  cachePath: string | null;
  cacheExpiresAt: Date | null;
}

type Row = typeof schema.emailAttachments.$inferSelect;

export class EmailAttachmentsRepo {
  constructor(private readonly db: Database) {}

  async createMany(
    orgId: string,
    activityId: string,
    inputs: NewAttachmentInput[],
  ): Promise<Row[]> {
    if (inputs.length === 0) return [];
    return this.db
      .insert(schema.emailAttachments)
      .values(
        inputs.map((i) => ({
          organizationId: orgId,
          activityId,
          filename: i.filename,
          mimeType: i.mimeType,
          sizeBytes: i.sizeBytes,
          cachePath: i.cachePath,
          cacheExpiresAt: i.cacheExpiresAt,
        })),
      )
      .returning();
  }

  async listForActivity(orgId: string, activityId: string): Promise<Row[]> {
    return this.db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(
          eq(schema.emailAttachments.organizationId, orgId),
          eq(schema.emailAttachments.activityId, activityId),
        ),
      )
      .orderBy(asc(schema.emailAttachments.createdAt));
  }

  async findById(orgId: string, id: string): Promise<Row | null> {
    const [row] = await this.db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(eq(schema.emailAttachments.organizationId, orgId), eq(schema.emailAttachments.id, id)),
      )
      .limit(1);
    return row ?? null;
  }

  async clearCachePath(id: string): Promise<void> {
    await this.db
      .update(schema.emailAttachments)
      .set({ cachePath: null, cacheExpiresAt: null })
      .where(eq(schema.emailAttachments.id, id));
  }

  async findExpiredForEviction(limit: number): Promise<Row[]> {
    return this.db
      .select()
      .from(schema.emailAttachments)
      .where(
        and(
          isNotNull(schema.emailAttachments.cachePath),
          lt(schema.emailAttachments.cacheExpiresAt, new Date()),
        ),
      )
      .limit(limit);
  }

  async deleteForActivity(orgId: string, activityId: string): Promise<Row[]> {
    return this.db
      .delete(schema.emailAttachments)
      .where(
        and(
          eq(schema.emailAttachments.organizationId, orgId),
          eq(schema.emailAttachments.activityId, activityId),
        ),
      )
      .returning();
  }
}
