import { z } from 'zod';

/**
 * Form text inputs submit "" (empty string) for blank optional fields, which
 * would otherwise fail `.min(1)`/`.email()` and silently block submission.
 * Treat a blank/whitespace-only string as "not provided" (undefined).
 */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

export const createContactBodySchema = z.object({
  firstName: z.string().min(1).max(120),
  lastName: blankToUndefined(z.string().min(1).max(120).optional()),
  email: blankToUndefined(z.string().email().max(255).optional()),
  phone: blankToUndefined(z.string().min(1).max(50).optional()),
  title: blankToUndefined(z.string().min(1).max(200).optional()),
  companyId: z.string().uuid().optional(),
  customFields: z.record(z.unknown()).optional(),
});

// `companyId` is nullable on update so the UI can *unassign* a contact's
// company by sending `null` (a plain `.partial()` would only allow setting it).
export const updateContactBodySchema = createContactBodySchema.partial().extend({
  companyId: z.string().uuid().nullable().optional(),
});

export type CreateContactInput = z.infer<typeof createContactBodySchema>;
export type UpdateContactInput = z.infer<typeof updateContactBodySchema>;

export interface PublicContact {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
