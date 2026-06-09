import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Check, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { OrgRole, PublicInvitation, PublicMember } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { cn } from '@/lib/utils';
import { ApiException } from '@/lib/api';
import { useCurrentOrg } from '@/features/organizations/api';
import {
  useChangeMemberRole,
  useLeaveOrg,
  useMembers,
  useMembership,
  useRemoveMember,
  useResendInvitation,
  useRevokeInvitation,
} from '@/features/members/api';
import { InviteDialog } from '@/features/members/invite-dialog';

export const Route = createFileRoute('/app/settings/members')({
  component: MembersPage,
});

// ───────────────────────────── helpers ─────────────────────────────

function initialsFor(input: string): string {
  const base = input.includes('@') ? input.split('@')[0]! : input;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : base.slice(0, 2);
  return letters.toUpperCase();
}

// Stable colour palette for member avatars (hash the userId/email).
const AVATAR_PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-fuchsia-100 text-fuchsia-700',
] as const;

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]!;
}

function formatJoinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiException) return err.error.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

// ───────────────────────────── pills ─────────────────────────────

function RolePill({ role }: { role: OrgRole }) {
  const styles: Record<OrgRole, string> = {
    owner: 'bg-indigo-50 text-indigo-700',
    admin: 'bg-emerald-100 text-emerald-700',
    member: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize',
        styles[role],
      )}
    >
      {role}
    </span>
  );
}

function PendingPill({ role }: { role: OrgRole }) {
  return (
    <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
      Pending · {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

// ───────────────────────────── role permissions ─────────────────────────────

const ROLE_CAPABILITIES: ReadonlyArray<{
  label: string;
  owner: boolean;
  admin: boolean;
  member: boolean;
}> = [
  { label: 'Use the CRM · create records', owner: true, admin: true, member: true },
  { label: 'View every record in the org', owner: true, admin: true, member: true },
  { label: 'Edit & delete records they own', owner: true, admin: true, member: true },
  { label: 'Edit & delete any record', owner: true, admin: true, member: false },
  { label: "Reassign a record's owner", owner: true, admin: true, member: false },
  { label: 'Invite, remove & set member roles', owner: true, admin: true, member: false },
  { label: 'Org settings, integrations & custom fields', owner: true, admin: true, member: false },
  { label: 'Manage admins & transfer ownership', owner: true, admin: false, member: false },
];

function CapCell({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Check className="mx-auto h-4 w-4 text-emerald-600" strokeWidth={2.5} aria-label="Yes" />
  ) : (
    <Minus className="mx-auto h-4 w-4 text-slate-300" strokeWidth={2.5} aria-label="No" />
  );
}

function RolePermissions() {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          What each role can do
        </h2>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Capability</th>
            <th className="px-3 py-2.5 text-center">
              <RolePill role="owner" />
            </th>
            <th className="px-3 py-2.5 text-center">
              <RolePill role="admin" />
            </th>
            <th className="px-3 py-2.5 text-center">
              <RolePill role="member" />
            </th>
          </tr>
        </thead>
        <tbody>
          {ROLE_CAPABILITIES.map((c) => (
            <tr key={c.label} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2.5 text-slate-700">{c.label}</td>
              <td className="px-3 py-2.5">
                <CapCell allowed={c.owner} />
              </td>
              <td className="px-3 py-2.5">
                <CapCell allowed={c.admin} />
              </td>
              <td className="px-3 py-2.5">
                <CapCell allowed={c.member} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
        Members can view everything but can only edit or delete records they own.
      </p>
    </section>
  );
}

// ───────────────────────────── skeletons ─────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-44 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-16 animate-pulse rounded-full bg-slate-100" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
      </td>
      <td className="px-4 py-3" />
    </tr>
  );
}

// ───────────────────────────── page ─────────────────────────────

function MembersPage() {
  const navigate = useNavigate();
  const orgQuery = useCurrentOrg();
  const membersQuery = useMembers();
  const membership = useMembership();
  const leave = useLeaveOrg();

  const [inviteOpen, setInviteOpen] = useState(false);

  const orgName = orgQuery.data?.organization.name ?? 'this organization';

  // Hide the alarming error state during the in-flight `leave` transition —
  // membership briefly resolves to `{ role: null }` while the cache clears
  // and the navigate to /app fires. The route guard there handles redirects.
  const isLeaving = leave.isPending;

  // Treat 401/403 / no membership as "go back to the app shell" — the app
  // route's beforeLoad will redirect to /login if the session is gone.
  if (!isLeaving && membersQuery.error && membersQuery.error instanceof ApiException) {
    const status = membersQuery.error.status;
    if (status === 401 || status === 403) {
      void navigate({ to: '/app' });
      return null;
    }
  }

  const owners = useMemo(() => {
    const list = membersQuery.data?.members ?? [];
    return list.filter((m) => m.role === 'owner');
  }, [membersQuery.data]);

  const isLastOwner =
    membership.currentUserId !== null &&
    owners.length === 1 &&
    owners[0]?.userId === membership.currentUserId;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Members</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            People with access to <span className="font-medium text-slate-700">{orgName}</span>.
            Invite teammates and manage their roles.
          </p>
        </div>
        {membership.isAdmin && (
          <Button onClick={() => setInviteOpen(true)} data-testid="invite-people-button">
            <Plus className="h-4 w-4" strokeWidth={2.25} />
            Invite people
          </Button>
        )}
      </div>

      {membersQuery.error && !isLeaving && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {extractErrorMessage(membersQuery.error)}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Member</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Joined</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {membersQuery.isPending && (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}
            {membersQuery.data?.members.map((m) => (
              <MemberRow
                key={m.userId}
                member={m}
                callerRole={membership.role}
                isAdmin={membership.isAdmin}
                currentUserId={membership.currentUserId}
                isLastOwner={isLastOwner}
                orgName={orgName}
              />
            ))}
          </tbody>
        </table>
      </section>

      {membersQuery.data && membersQuery.data.invitations.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Pending invitations
            </h2>
          </header>
          <table className="w-full text-sm">
            <tbody>
              {membersQuery.data.invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  isAdmin={membership.isAdmin}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      <RolePermissions />

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </main>
  );
}

// ───────────────────────────── member row ─────────────────────────────

interface MemberRowProps {
  member: PublicMember;
  callerRole: OrgRole | null;
  isAdmin: boolean;
  currentUserId: string | null;
  isLastOwner: boolean;
  orgName: string;
}

function MemberRow({
  member,
  callerRole,
  isAdmin,
  currentUserId,
  isLastOwner,
  orgName,
}: MemberRowProps) {
  const isSelf = member.userId === currentUserId;
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  const leaveOrg = useLeaveOrg();
  const [rowError, setRowError] = useState<string | null>(null);

  const avatarClass = colorFor(member.userId);

  // What the caller can do on this row.
  // - The caller never edits their own role here (see spec — out of scope).
  // - Only the owner can grant/revoke `owner` (server enforces this too).
  // - A plain member sees a read-only pill on others' rows.
  const canEditOthersRole = isAdmin && !isSelf;
  const canShowOwnerOption = callerRole === 'owner';

  async function handleRoleChange(nextRole: OrgRole) {
    if (nextRole === member.role) return;
    setRowError(null);
    try {
      await changeRole.mutateAsync({ userId: member.userId, role: nextRole });
      toast.success(`Updated ${member.name || member.email} to ${nextRole}.`);
    } catch (err) {
      setRowError(extractErrorMessage(err));
    }
  }

  async function handleRemove() {
    setRowError(null);
    try {
      await removeMember.mutateAsync(member.userId);
      toast.success(`Removed ${member.name || member.email} from ${orgName}.`);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setRowError(msg);
      toast.error(msg);
    }
  }

  async function handleLeave() {
    setRowError(null);
    try {
      await leaveOrg.mutateAsync();
    } catch (err) {
      const msg = extractErrorMessage(err);
      setRowError(msg);
      toast.error(msg);
    }
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              avatarClass,
            )}
          >
            {initialsFor(member.name || member.email)}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">
              {member.name || member.email.split('@')[0]}
              {isSelf && <span className="ml-1.5 text-[11px] font-normal text-slate-400">· you</span>}
            </div>
            <div className="truncate text-xs text-slate-500">{member.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        {canEditOthersRole && member.role !== 'owner' ? (
          <div className="flex items-center gap-2">
            <select
              value={member.role}
              onChange={(e) => void handleRoleChange(e.target.value as OrgRole)}
              disabled={changeRole.isPending}
              aria-label={`Change role for ${member.name || member.email}`}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12.5px] font-medium text-slate-700 shadow-sm focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {canShowOwnerOption && <option value="owner">Owner</option>}
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            {changeRole.isPending && changeRole.variables?.userId === member.userId && (
              <span className="text-[11px] text-slate-400">saving…</span>
            )}
          </div>
        ) : canEditOthersRole && member.role === 'owner' && canShowOwnerOption ? (
          // Another owner — the only way to demote is through transfer, which
          // is out of scope; show a non-editable pill.
          <RolePill role={member.role} />
        ) : (
          <RolePill role={member.role} />
        )}
        {rowError && <p className="mt-1 text-[11px] text-red-600">{rowError}</p>}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">{formatJoinedDate(member.joinedAt)}</td>
      <td className="px-4 py-3 text-right">
        {isSelf ? (
          isLastOwner ? (
            <button
              type="button"
              disabled
              title="You're the last owner — promote someone first."
              className="cursor-not-allowed rounded-md border border-slate-200 px-2.5 py-1 text-[12.5px] font-semibold text-slate-300"
            >
              Leave
            </button>
          ) : (
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                  data-testid="leave-org-button"
                >
                  Leave
                </button>
              }
              title="Leave this organization?"
              description={`You'll lose access to ${orgName}'s data.`}
              confirmLabel="Leave"
              destructive
              onConfirm={handleLeave}
            />
          )
        ) : isAdmin ? (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                className="text-[12.5px] font-semibold text-red-600 transition-colors hover:text-red-700"
              >
                Remove
              </button>
            }
            title={`Remove ${member.name || member.email} from ${orgName}?`}
            description="They'll immediately lose access. You can re-invite them later."
            confirmLabel="Remove"
            destructive
            onConfirm={handleRemove}
          />
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

// ───────────────────────────── invitation row ─────────────────────────────

interface InvitationRowProps {
  invitation: PublicInvitation;
  isAdmin: boolean;
}

function InvitationRow({ invitation, isAdmin }: InvitationRowProps) {
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const [rowError, setRowError] = useState<string | null>(null);

  const daysLeft = daysUntil(invitation.expiresAt);
  const expiryLabel =
    daysLeft <= 0
      ? 'expired'
      : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  async function handleResend() {
    setRowError(null);
    try {
      await resend.mutateAsync(invitation.id);
      toast.success(`Resent invitation to ${invitation.email}.`);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setRowError(msg);
      toast.error(msg);
    }
  }

  async function handleRevoke() {
    setRowError(null);
    try {
      await revoke.mutateAsync(invitation.id);
      toast.success(`Revoked invitation for ${invitation.email}.`);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setRowError(msg);
      toast.error(msg);
    }
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700"
          >
            @
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{invitation.email}</div>
            <div className="truncate text-xs text-slate-500">
              Invitation sent · {expiryLabel}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-middle">
        <PendingPill role={invitation.role} />
        {rowError && <p className="mt-1 text-[11px] text-red-600">{rowError}</p>}
      </td>
      <td className="px-4 py-3 text-xs text-slate-400">—</td>
      <td className="px-4 py-3 text-right">
        {isAdmin ? (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={resend.isPending}
              className="text-[12.5px] font-semibold text-indigo-700 transition-colors hover:text-indigo-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resend.isPending && resend.variables === invitation.id ? 'Resending…' : 'Resend'}
            </button>
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  className="text-[12.5px] font-semibold text-red-600 transition-colors hover:text-red-700"
                >
                  Revoke
                </button>
              }
              title={`Revoke invitation for ${invitation.email}?`}
              description="The invite link will stop working immediately."
              confirmLabel="Revoke"
              destructive
              onConfirm={handleRevoke}
            />
          </div>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}
