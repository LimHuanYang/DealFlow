import { and, eq } from 'drizzle-orm';
import type { Database } from '@dealflow/db';
import { schema } from '@dealflow/db';
import {
  type CustomFieldEntityType,
  validateCustomFieldValue,
} from '@dealflow/shared';

export interface MergeArgs {
  orgId: string;
  entityType: CustomFieldEntityType;
  existing: Record<string, unknown>;
  patch: Record<string, unknown> | undefined;
  isCreate: boolean;
}

export type MergeResult =
  | { ok: true; merged: Record<string, unknown> }
  | { ok: false; status: 400; error: string; fieldErrors?: Record<string, string> };

/**
 * Validates an inbound `customFields` patch against the active definitions
 * for the org + entity type, then merges into `existing`. Returns the merged
 * JSONB on success or a structured 400 on failure.
 *
 * Behaviour:
 *   - Unknown field keys (no matching definition) → 400.
 *   - Type-invalid values (per shared `validateCustomFieldValue`) → 400.
 *   - `required:true` definitions absent at create time → 400.
 *   - Patch entries with `null` clear the field (set to null in merged JSONB).
 *   - When `patch` is undefined, returns `existing` unchanged.
 */
export async function validateAndMergeCustomFields(
  deps: { db: Database },
  args: MergeArgs,
): Promise<MergeResult> {
  if (!args.patch) return { ok: true, merged: args.existing };

  const defs = await deps.db
    .select()
    .from(schema.customFieldDefinitions)
    .where(
      and(
        eq(schema.customFieldDefinitions.organizationId, args.orgId),
        eq(schema.customFieldDefinitions.entityType, args.entityType),
      ),
    );
  const defById = new Map(defs.map((d) => [d.id, d]));

  const merged: Record<string, unknown> = { ...args.existing };
  const fieldErrors: Record<string, string> = {};

  for (const [key, value] of Object.entries(args.patch)) {
    const def = defById.get(key);
    if (!def) {
      fieldErrors[key] = 'unknown_field';
      continue;
    }
    const v = validateCustomFieldValue({ type: def.type as never, options: def.options }, value);
    if (!v.ok) {
      fieldErrors[key] = v.error;
      continue;
    }
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  if (args.isCreate) {
    for (const def of defs) {
      if (!def.required) continue;
      const v = merged[def.id];
      if (v === null || v === undefined) {
        fieldErrors[def.id] = 'required';
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, error: 'Invalid custom fields', fieldErrors };
  }
  return { ok: true, merged };
}
