import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import type {
  CreateCustomFieldBody,
  CustomFieldDefinition,
  CustomFieldEntityType,
  UpdateCustomFieldBody,
} from '@dealflow/shared';

export class CustomFieldsRepo {
  constructor(private readonly db: Database) {}

  async list(orgId: string, entityType: CustomFieldEntityType): Promise<CustomFieldDefinition[]> {
    const rows = await this.db
      .select()
      .from(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, orgId),
          eq(schema.customFieldDefinitions.entityType, entityType),
        ),
      )
      .orderBy(asc(schema.customFieldDefinitions.position));
    return rows.map(toPublic);
  }

  async create(orgId: string, input: CreateCustomFieldBody): Promise<CustomFieldDefinition> {
    const [row] = await this.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: input.entityType,
        name: input.name.trim(),
        type: input.type,
        options: input.options ?? null,
        required: input.required ?? false,
        position: input.position ?? 0,
      })
      .returning();
    if (!row) throw new Error('Insert returned no row');
    return toPublic(row);
  }

  async update(
    orgId: string,
    id: string,
    patch: UpdateCustomFieldBody,
  ): Promise<CustomFieldDefinition | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.options !== undefined) set.options = patch.options;
    if (patch.required !== undefined) set.required = patch.required;
    if (patch.position !== undefined) set.position = patch.position;

    const [row] = await this.db
      .update(schema.customFieldDefinitions)
      .set(set)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, orgId),
          eq(schema.customFieldDefinitions.id, id),
        ),
      )
      .returning();
    return row ? toPublic(row) : null;
  }

  async delete(orgId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, orgId),
          eq(schema.customFieldDefinitions.id, id),
        ),
      )
      .returning({ id: schema.customFieldDefinitions.id });
    return rows.length > 0;
  }
}

function toPublic(row: typeof schema.customFieldDefinitions.$inferSelect): CustomFieldDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    entityType: row.entityType as CustomFieldEntityType,
    name: row.name,
    type: row.type as CustomFieldDefinition['type'],
    options: row.options ?? null,
    required: row.required,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
