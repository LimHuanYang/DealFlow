import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link2, Mail } from 'lucide-react';
import {
  createInvitationBodySchema,
  type CreateInvitationInput,
  type PublicInvitation,
} from '@dealflow/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiException } from '@/lib/api';
import { useCurrentOrg } from '@/features/organizations/api';
import { useInviteMember } from './api';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SuccessState {
  invitation: PublicInvitation;
  inviteUrl: string;
}

/**
 * Modal for an owner/admin to invite a teammate by email. After a successful
 * create, the dialog stays open and shows the invite URL with a copy button
 * — so even if SMTP isn't configured, the user can hand the link off.
 */
export function InviteDialog({ open, onOpenChange }: InviteDialogProps) {
  const orgQuery = useCurrentOrg();
  const orgName = orgQuery.data?.organization.name ?? 'your organization';

  const invite = useInviteMember();

  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | undefined>(undefined);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvitationInput>({
    resolver: zodResolver(createInvitationBodySchema),
    defaultValues: { email: '', role: 'member' },
  });

  // When the dialog closes, wipe everything so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setSuccess(null);
      setSubmitError(null);
      setCopied(false);
      reset({ email: '', role: 'member' });
    }
  }, [open, reset]);

  // Clear any pending "Copied" timer when the component unmounts.
  useEffect(
    () => () => {
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  async function onSubmit(values: CreateInvitationInput) {
    setSubmitError(null);
    try {
      const res = await invite.mutateAsync(values);
      setSuccess({ invitation: res.invitation, inviteUrl: res.inviteUrl });
    } catch (err) {
      if (err instanceof ApiException) {
        setSubmitError({ code: err.error.code, message: err.error.message });
      } else {
        setSubmitError({
          code: 'UNKNOWN',
          message: 'Something went wrong. Please try again.',
        });
      }
    }
  }

  async function handleCopyLink() {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.inviteUrl);
      setCopied(true);
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; surface a small notice
      // inline so the URL is still visible in the <code> block for manual copy.
      setSubmitError({
        code: 'CLIPBOARD',
        message: "Couldn't access the clipboard — copy the link manually.",
      });
    }
  }

  function handleSendAnother() {
    setSuccess(null);
    setSubmitError(null);
    setCopied(false);
    reset({ email: '', role: 'member' });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite teammates</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email link to join <b className="text-slate-700">{orgName}</b>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-w-0 flex-col gap-4" noValidate>
          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                placeholder="teammate@example.com"
                autoFocus
                disabled={success !== null}
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>
            <div className="flex w-32 flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-400 focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={success !== null}
                {...register('role')}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              Sent via your connected SMTP. No SMTP configured? You&apos;ll get a copyable invite
              link instead.
            </span>
          </div>

          {success && (
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900"
              data-testid="invite-success"
            >
              <p className="font-medium">
                Invitation sent to {success.invitation.email}.
              </p>
              <p className="mt-0.5 text-xs text-emerald-800">
                Anyone with the link can join.
              </p>
              <code className="mt-2 block w-full whitespace-pre-wrap break-all rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
                {success.inviteUrl}
              </code>
            </div>
          )}

          {submitError && (
            <div
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              <p>{submitError.message}</p>
              {submitError.code === 'ALREADY_INVITED' && (
                <p className="mt-1 text-xs text-red-600">
                  Resend the existing invitation from the members list instead.
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap !justify-between gap-2 sm:!flex-row sm:items-center">
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={!success}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:text-indigo-900 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              <Link2 className="h-3.5 w-3.5" strokeWidth={2.25} />
              {copied ? 'Copied' : 'Copy invite link'}
            </button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {success ? 'Done' : 'Cancel'}
              </Button>
              {success ? (
                <Button type="button" onClick={handleSendAnother}>
                  Send another
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting || invite.isPending}>
                  {isSubmitting || invite.isPending ? 'Sending…' : 'Send invite'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
