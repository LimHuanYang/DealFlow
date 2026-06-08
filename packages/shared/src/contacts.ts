import { z } from 'zod';
import { blankToUndefined } from './zod-helpers.js';

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
//
// `ownerUserId` lets owners/admins *reassign* a record to another user. The
// route enforces that only owner/admin may set it; a member who includes it is
// rejected (see contacts routes / assertCanWrite). It is intentionally absent
// from `createContactBodySchema` — create always assigns ownership to the
// acting user server-side.
export const updateContactBodySchema = createContactBodySchema.partial().extend({
  companyId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().optional(),
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
