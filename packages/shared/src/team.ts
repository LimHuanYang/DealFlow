import { z } from 'zod';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const orgRoleSchema = z.enum(ORG_ROLES);
/** Roles an admin/owner may assign via invite or role-change (never directly grant owner). */
export const assignableRoleSchema = z.enum(['admin', 'member']);

export const createInvitationBodySchema = z.object({
  email: z.string().email(),
  role: assignableRoleSchema,
});
export const updateMemberRoleBodySchema = z.object({ role: orgRoleSchema });
export const switchOrgBodySchema = z.object({ organizationId: z.string().uuid() });
export const acceptInvitationBodySchema = z.object({
  name: z.string().min(1).optional(),
  password: z.string().min(8).optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationBodySchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationBodySchema>;

export interface PublicMember {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
}
export interface PublicInvitation {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
}
export interface PublicOrgSummary {
  id: string;
  name: string;
  role: OrgRole;
}
export interface InvitationPreview {
  orgName: string;
  inviterName: string | null;
  role: OrgRole;
  emailHasAccount: boolean;
  expired: boolean;
}
