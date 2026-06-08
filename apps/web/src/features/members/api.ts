import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type {
  CreateInvitationInput,
  OrgRole,
  PublicInvitation,
  PublicMember,
  PublicOrgSummary,
} from '@dealflow/shared';
import { apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { getMe } from '@/lib/auth';

// ───────────────────────────── response shapes ─────────────────────────────

export interface MembersListResponse {
  members: PublicMember[];
  invitations: PublicInvitation[];
}

export interface OrgsListResponse {
  orgs: PublicOrgSummary[];
}

export interface InvitationCreatedResponse {
  invitation: PublicInvitation;
  inviteUrl: string;
}

export interface InvitationResendResponse {
  invitation: PublicInvitation;
}

// ───────────────────────────── raw API calls ───────────────────────────────

function listMembers(): Promise<MembersListResponse> {
  return apiFetch<MembersListResponse>('/api/v1/orgs/current/members');
}

function listOrgs(): Promise<OrgsListResponse> {
  return apiFetch<OrgsListResponse>('/api/v1/orgs');
}

function inviteMember(input: CreateInvitationInput): Promise<InvitationCreatedResponse> {
  return apiFetch('/api/v1/orgs/current/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

function resendInvitation(id: string): Promise<InvitationResendResponse> {
  return apiFetch(`/api/v1/orgs/current/invitations/${id}/resend`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function revokeInvitation(id: string): Promise<void> {
  return apiFetch(`/api/v1/orgs/current/invitations/${id}`, { method: 'DELETE' });
}

function changeMemberRole(userId: string, role: OrgRole): Promise<{ ok: true }> {
  return apiFetch(`/api/v1/orgs/current/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

function removeMember(userId: string): Promise<void> {
  return apiFetch(`/api/v1/orgs/current/members/${userId}`, { method: 'DELETE' });
}

function leaveOrg(): Promise<{ ok: true }> {
  return apiFetch('/api/v1/orgs/current/members/leave', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function switchOrg(organizationId: string): Promise<{ ok: true }> {
  return apiFetch('/api/v1/orgs/switch', {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
}

// ───────────────────────────── read hooks ──────────────────────────────────

/** GET /orgs/current/members — returns members and pending invitations. */
export function useMembers() {
  return useQuery({
    queryKey: queryKeys.members.list(),
    queryFn: listMembers,
  });
}

/** GET /orgs — orgs the current user belongs to. */
export function useOrgs() {
  return useQuery({
    queryKey: queryKeys.orgs.list(),
    queryFn: listOrgs,
  });
}

/**
 * Derived hook: the caller's identity + role + admin flag in the active org.
 *
 * - `currentUserId` from `getMe()` (the same source the rest of the app uses).
 * - `role` matched from `useMembers()` by user id.
 * - `isAdmin` is true for `owner` and `admin`.
 *
 * Returns a fully-null shape gracefully when either query is still loading
 * or returned an error / no membership.
 */
export function useMembership(): {
  role: OrgRole | null;
  isAdmin: boolean;
  currentUserId: string | null;
} {
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: getMe });
  const membersQuery = useMembers();

  return useMemo(() => {
    const currentUserId = meQuery.data?.user.id ?? null;
    if (!currentUserId || !membersQuery.data) {
      return { role: null, isAdmin: false, currentUserId };
    }
    const me = membersQuery.data.members.find((m) => m.userId === currentUserId);
    const role = me?.role ?? null;
    return {
      role,
      isAdmin: role === 'owner' || role === 'admin',
      currentUserId,
    };
  }, [meQuery.data, membersQuery.data]);
}

// ───────────────────────────── mutation hooks ──────────────────────────────

/** POST /orgs/current/invitations — invalidates members list (which carries invites). */
export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inviteMember,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members.list() });
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.list() });
    },
  });
}

/** POST /orgs/current/invitations/:id/resend */
export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resendInvitation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members.list() });
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.list() });
    },
  });
}

/** DELETE /orgs/current/invitations/:id */
export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: revokeInvitation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members.list() });
      void qc.invalidateQueries({ queryKey: queryKeys.invitations.list() });
    },
  });
}

/** PATCH /orgs/current/members/:userId */
export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; role: OrgRole }) =>
      changeMemberRole(input.userId, input.role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members.list() });
      // Your own role may have changed (or actor demoted itself).
      void qc.invalidateQueries({ queryKey: queryKeys.membership.current });
    },
  });
}

/** DELETE /orgs/current/members/:userId */
export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.members.list() });
      void qc.invalidateQueries({ queryKey: queryKeys.membership.current });
    },
  });
}

/**
 * POST /orgs/current/members/leave.
 *
 * Clears every cached query (everything was scoped to the org we just left)
 * and routes the user back to the app shell, which will redirect to /login
 * if the session no longer resolves to an org.
 */
export function useLeaveOrg() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: leaveOrg,
    onSuccess: async () => {
      qc.clear();
      await navigate({ to: '/app' });
    },
  });
}

/**
 * POST /orgs/switch — repoints the session's current_org_id to a new org.
 *
 * Every cached query is scoped to the previous org's data, so we wipe the
 * query cache wholesale and re-route to /app to refetch everything fresh.
 */
export function useSwitchOrg() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (input: { organizationId: string }) => switchOrg(input.organizationId),
    onSuccess: async () => {
      qc.clear();
      await navigate({ to: '/app' });
    },
  });
}
