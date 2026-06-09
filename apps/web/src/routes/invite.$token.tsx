import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InvitationPreview, OrgRole } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiException, apiFetch } from '@/lib/api';
import { getMe } from '@/lib/auth';
import { queryKeys } from '@/lib/query-keys';

export const Route = createFileRoute('/invite/$token')({
  component: AcceptInvitePage,
});

// ───────────────────────────── API calls ───────────────────────────────────

function getInvitationPreview(token: string): Promise<InvitationPreview> {
  return apiFetch<InvitationPreview>(`/api/v1/invitations/${token}`);
}

interface AcceptResult {
  organizationId: string;
  role: OrgRole;
}

function acceptInvitation(
  token: string,
  body: { name?: string; password?: string },
): Promise<AcceptResult> {
  return apiFetch<AcceptResult>(`/api/v1/invitations/${token}/accept`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ───────────────────────────── helpers ─────────────────────────────────────

const roleLabel = (role: OrgRole): string => role.charAt(0).toUpperCase() + role.slice(1);

/** Centered auth-card chrome shared by every state on this page. */
function CardShell({ children, width = 'max-w-md' }: { children: React.ReactNode; width?: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className={`w-full ${width}`}>
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm">
            DF
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">DealFlow</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

function BackToSignIn() {
  return (
    <p className="mt-6 text-center text-sm text-slate-500">
      <a className="font-medium text-slate-500 hover:text-slate-700 hover:underline" href="/login">
        Back to sign in
      </a>
    </p>
  );
}

// ───────────────────────────── component ───────────────────────────────────

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const preview = useQuery({
    queryKey: ['invitations', 'preview', token] as const,
    queryFn: () => getInvitationPreview(token),
    retry: false,
  });

  // Local override so a 410 INVITATION_EXPIRED at accept-time can flip the page
  // into the "expired" rendering without refetching the preview.
  const [forcedExpired, setForcedExpired] = useState(false);

  // 1. Loading
  if (preview.isPending) {
    return (
      <CardShell>
        <div className="animate-pulse">
          <div className="h-6 w-40 rounded bg-slate-200" />
          <p className="mt-4 text-sm text-slate-500">Checking your invitation…</p>
          <div className="mt-6 space-y-3">
            <div className="h-10 rounded-lg bg-slate-100" />
            <div className="h-10 rounded-lg bg-slate-100" />
          </div>
        </div>
      </CardShell>
    );
  }

  // 2 + 3. Error states from the preview fetch.
  if (preview.error) {
    const status = preview.error instanceof ApiException ? preview.error.status : 0;

    if (status === 410) {
      return (
        <CardShell>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Already accepted</h1>
          <p className="mt-2 text-sm text-slate-500">
            This invitation has already been used. If that was you, just sign in to access your
            workspace.
          </p>
          <Button className="mt-6 w-full" onClick={() => void navigate({ to: '/login' })}>
            Sign in
          </Button>
        </CardShell>
      );
    }

    // 404 INVITATION_NOT_FOUND and any other failure fall through to the
    // generic "not found" card.
    return (
      <CardShell>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Invitation not found
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          This link is invalid or has already been used. Ask the person who invited you to send a
          new one.
        </p>
        <BackToSignIn />
      </CardShell>
    );
  }

  const data = preview.data;

  // 4. Expired (a normal 200 render, or a 410 raised at accept-time).
  if (data.expired || forcedExpired) {
    return (
      <CardShell>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          This invitation has expired
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Invitations expire after 7 days. Ask {data.inviterName ?? 'the admin'} to send a new one.
        </p>
        <BackToSignIn />
      </CardShell>
    );
  }

  // 5. Live invitation → accept flow.
  return (
    <AcceptForm
      token={token}
      data={data}
      navigate={navigate}
      queryClient={queryClient}
      onExpired={() => setForcedExpired(true)}
    />
  );
}

// ───────────────────────────── accept form ─────────────────────────────────

interface AcceptFormProps {
  token: string;
  data: InvitationPreview;
  navigate: ReturnType<typeof useNavigate>;
  queryClient: ReturnType<typeof useQueryClient>;
  onExpired: () => void;
}

const newUserSchema = z.object({
  name: z.string().min(1, 'Your name is required'),
  password: z.string().min(12, 'At least 12 characters'),
});
type NewUserValues = z.infer<typeof newUserSchema>;

function AcceptForm({ token, data, navigate, queryClient, onExpired }: AcceptFormProps) {
  const { orgName, inviterName, role } = data;

  async function onAccepted() {
    toast.success(`Welcome to ${orgName}!`);
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
    await navigate({ to: '/app/dashboard' });
  }

  /**
   * Shared accept-error mapping for both paths.
   * Returns a string to surface inline, or null when it already handled the
   * error by redirecting / switching state.
   */
  function mapAcceptError(err: unknown): string | null {
    if (err instanceof ApiException) {
      if (err.status === 401 && err.error.code === 'SIGNIN_REQUIRED') {
        toast.error('Sign in with the invited email to accept.');
        void navigate({ to: '/login', search: { next: `/invite/${token}` } });
        return null;
      }
      if (err.status === 410) {
        onExpired();
        return null;
      }
      return err.error.message;
    }
    return 'Something went wrong. Please try again.';
  }

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Join {orgName} on DealFlow
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {inviterName ?? 'Someone'} invited you to join {orgName} as a {roleLabel(role)}.
      </p>
    </div>
  );

  return (
    <CardShell>
      {header}
      {data.emailHasAccount ? (
        <ExistingUserBody
          token={token}
          orgName={orgName}
          onAccepted={onAccepted}
          mapAcceptError={mapAcceptError}
        />
      ) : (
        <NewUserBody onAccepted={onAccepted} token={token} mapAcceptError={mapAcceptError} />
      )}
    </CardShell>
  );
}

// ───────────────────────────── new-user path ───────────────────────────────

function NewUserBody({
  token,
  onAccepted,
  mapAcceptError,
}: {
  token: string;
  onAccepted: () => Promise<void>;
  mapAcceptError: (err: unknown) => string | null;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewUserValues>({ resolver: zodResolver(newUserSchema) });

  async function onSubmit(values: NewUserValues) {
    setServerError(null);
    try {
      await acceptInvitation(token, { name: values.name, password: values.password });
      await onAccepted();
    } catch (err) {
      setServerError(mapAcceptError(err));
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mt-6 flex flex-col gap-4"
      noValidate
      data-testid="accept-invite-form"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" autoComplete="name" autoFocus {...register('name')} />
        {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Create a password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register('password')}
        />
        {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
      </div>
      {serverError && <p className="text-sm text-red-600">{serverError}</p>}
      <Button type="submit" disabled={isSubmitting} data-testid="accept-submit">
        {isSubmitting ? 'Joining…' : 'Create account & join'}
      </Button>
    </form>
  );
}

// ───────────────────────────── existing-user path ──────────────────────────

function ExistingUserBody({
  token,
  orgName,
  onAccepted,
  mapAcceptError,
}: {
  token: string;
  orgName: string;
  onAccepted: () => Promise<void>;
  mapAcceptError: (err: unknown) => string | null;
}) {
  const navigate = useNavigate();
  // 'checking' until getMe resolves; then either auto-accept ('joining') or
  // present the sign-in CTA ('signin').
  const [phase, setPhase] = useState<'checking' | 'joining' | 'signin'>('checking');
  const [serverError, setServerError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    // Guard against double-invoke (StrictMode) — only ever start the flow once.
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    void (async () => {
      const me = await getMe().catch(() => null);
      if (cancelled) return;

      // Signed in as the invited user → one-click auto-accept (the happy path
      // from the invite email). The API matches by session, so any signed-in
      // user gets a deterministic 200 (correct user) or 401 SIGNIN_REQUIRED.
      if (me) {
        setPhase('joining');
        try {
          await acceptInvitation(token, {});
          if (cancelled) return;
          await onAccepted();
        } catch (err) {
          if (cancelled) return;
          const msg = mapAcceptError(err);
          // 401 / 410 are handled inside mapAcceptError (redirect / state flip).
          // Anything else (msg != null) → drop back to the sign-in CTA + error.
          if (msg !== null) {
            setServerError(msg);
            setPhase('signin');
          }
        }
      } else {
        setPhase('signin');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'checking' || phase === 'joining') {
    return (
      <div className="mt-8 flex items-center gap-3 text-sm text-slate-500" aria-live="polite">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        {phase === 'joining' ? `Joining ${orgName}…` : 'Checking your account…'}
      </div>
    );
  }

  // Not signed in, signed in as someone else, or a non-fatal accept error.
  return (
    <div className="mt-6 flex flex-col gap-4">
      {serverError && <p className="text-sm text-red-600">{serverError}</p>}
      <Button
        className="w-full"
        data-testid="accept-submit"
        onClick={() => void navigate({ to: '/login', search: { next: `/invite/${token}` } })}
      >
        Sign in to join
      </Button>
      <p className="text-center text-xs text-slate-500">
        Signed in as a different user?{' '}
        <a className="font-medium text-slate-600 hover:underline" href="/login">
          Sign out and reopen this link.
        </a>
      </p>
    </div>
  );
}
