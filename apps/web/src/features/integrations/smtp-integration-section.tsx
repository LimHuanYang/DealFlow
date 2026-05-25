import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getMe } from '@/lib/auth';
import { queryKeys } from '@/lib/query-keys';
import { useIntegrations, useTestEmail, useUpdateIntegrations } from './api';

/**
 * Supported SMTP providers. We restrict to these three because they're the
 * only consumer-mail platforms with a stable App Password flow that pairs
 * cleanly with username/password SMTP. Adding a custom-host escape hatch
 * (corporate Exchange, self-hosted Postfix) is a Phase 2 concern.
 */
const PROVIDERS = {
  gmail: {
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    appPasswordHelp: 'Enable 2-Step Verification first, then generate a 16-character App Password.',
    userPlaceholder: 'you@gmail.com',
  },
  outlook: {
    label: 'Outlook.com / Hotmail',
    host: 'smtp-mail.outlook.com',
    port: 587,
    appPasswordUrl: 'https://account.live.com/proofs/AppPassword',
    appPasswordHelp:
      'Enable two-step verification on your Microsoft account, then create an App Password.',
    userPlaceholder: 'you@outlook.com',
  },
  yahoo: {
    label: 'Yahoo Mail',
    host: 'smtp.mail.yahoo.com',
    port: 587,
    appPasswordUrl: 'https://login.yahoo.com/account/security',
    appPasswordHelp:
      'Under Account Security, turn on 2-Step Verification, then click "Generate app password".',
    userPlaceholder: 'you@yahoo.com',
  },
} as const;

type ProviderKey = keyof typeof PROVIDERS;
const PROVIDER_KEYS = Object.keys(PROVIDERS) as ProviderKey[];

/**
 * Light email-shape check for the recipient input. The server still does
 * the authoritative `z.string().email()` validation — this just catches
 * obvious typos (missing @, comma instead of dot in the TLD, trailing
 * whitespace) before we round-trip a doomed request to the API.
 */
function isEmailLike(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.,]{2,}$/.test(raw.trim());
}

/**
 * Match a stored SMTP host back to a supported provider. Returns 'gmail' as
 * a safe default for unknown hosts (e.g., a config saved before we narrowed
 * to three providers) so the form still renders something sensible.
 */
function detectProvider(host: string | undefined): ProviderKey {
  if (!host) return 'gmail';
  return PROVIDER_KEYS.find((k) => PROVIDERS[k].host === host) ?? 'gmail';
}

interface SmtpFormState {
  provider: ProviderKey;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

const EMPTY: SmtpFormState = {
  provider: 'gmail',
  user: '',
  pass: '',
  fromEmail: '',
  fromName: '',
};

export function SmtpIntegrationSection() {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  const test = useTestEmail();

  // Registration email — used to pre-fill the From email field on first
  // configuration (so a user landing on Settings without an SMTP config
  // doesn't have to retype their address) and as the default recipient
  // for the test-send button.
  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: getMe });
  const myEmail = meQuery.data?.user?.email ?? '';

  const [form, setForm] = useState<SmtpFormState>(EMPTY);
  const [testTo, setTestTo] = useState<string>('');

  // When integrations load, seed everything EXCEPT password (we never send it back).
  // The stored host is mapped back to one of the three supported provider keys.
  // For brand-new orgs with no saved config, fall back to the registration
  // email so the user can click Save without typing their address twice.
  useEffect(() => {
    const s = integrations.data?.smtp;
    if (!s || !s.configured) {
      // No saved config — pre-fill From email + username from the
      // registration email so the form is one paste-of-app-password away
      // from working.
      if (myEmail) {
        setForm((prev) => ({
          ...prev,
          user: prev.user || myEmail,
          fromEmail: prev.fromEmail || myEmail,
        }));
      }
      return;
    }
    setForm((prev) => ({
      ...prev,
      provider: detectProvider(s.host ?? undefined),
      user: s.user ?? '',
      fromEmail: s.fromEmail ?? '',
      fromName: s.fromName ?? '',
    }));
  }, [integrations.data, myEmail]);

  // Default the test recipient to the registration email once it loads. The
  // user can edit it before pressing "Send test email".
  useEffect(() => {
    if (myEmail && !testTo) setTestTo(myEmail);
  }, [myEmail, testTo]);

  async function onSave() {
    if (!form.user.trim() || !form.fromEmail.trim() || !form.pass.trim()) {
      return;
    }
    const cfg = PROVIDERS[form.provider];
    await update.mutateAsync({
      smtp: {
        host: cfg.host,
        port: cfg.port,
        user: form.user.trim(),
        pass: form.pass,
        fromEmail: form.fromEmail.trim(),
        fromName: form.fromName.trim() || undefined,
      },
    });
    setForm((prev) => ({ ...prev, pass: '' }));
  }

  async function onClear() {
    await update.mutateAsync({ smtp: null });
    setForm(EMPTY);
  }

  async function onTest() {
    const to = testTo.trim();
    try {
      await test.mutateAsync(to ? { to } : {});
    } catch (err) {
      // mutateAsync rejects on any non-2xx. test.isError + test.error already
      // drive the UI; log here so DevTools shows the stack regardless of
      // whether the user re-renders.
      console.error('[smtp test-email] request failed:', err);
    }
  }

  const view = integrations.data?.smtp;
  const providerCfg = PROVIDERS[form.provider];

  return (
    <section
      className="mt-4 rounded-md border border-neutral-200 p-4"
      data-testid="smtp-integration"
    >
      <h2 className="mb-3 text-base font-medium">Email (SMTP)</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Send email from your Gmail, Outlook, or Yahoo account. {providerCfg.appPasswordHelp} Paste
        the App Password (not your regular password) into the field below.{' '}
        <a href={providerCfg.appPasswordUrl} target="_blank" rel="noreferrer" className="underline">
          Open {providerCfg.label} App Password settings →
        </a>
      </p>

      {integrations.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {integrations.data && (
        <>
          {view?.configured ? (
            <p className="mb-3 text-xs text-green-700">
              ✓ Configured · sending as <code>{view.fromEmail}</code>
            </p>
          ) : (
            <p className="mb-3 text-xs text-neutral-400">Not configured</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label htmlFor="smtp-provider" className="text-xs">
                Provider
              </Label>
              <select
                id="smtp-provider"
                value={form.provider}
                onChange={(e) =>
                  setForm((p) => ({ ...p, provider: e.target.value as ProviderKey }))
                }
                data-testid="smtp-provider"
                className="flex h-10 w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:ring-offset-2"
              >
                {PROVIDER_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {PROVIDERS[k].label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-neutral-400">
                Sends via{' '}
                <code>
                  {providerCfg.host}:{providerCfg.port}
                </code>
              </p>
            </div>
            <div>
              <Label htmlFor="smtp-user" className="text-xs">
                Username
              </Label>
              <Input
                id="smtp-user"
                value={form.user}
                onChange={(e) => setForm((p) => ({ ...p, user: e.target.value }))}
                placeholder={providerCfg.userPlaceholder}
                data-testid="smtp-user"
              />
            </div>
            <div>
              <Label htmlFor="smtp-pass" className="text-xs">
                App Password
              </Label>
              <Input
                id="smtp-pass"
                type="password"
                value={form.pass}
                onChange={(e) => setForm((p) => ({ ...p, pass: e.target.value }))}
                placeholder={view?.configured ? '(unchanged)' : ''}
                data-testid="smtp-pass"
              />
            </div>
            <div>
              <Label htmlFor="smtp-from-email" className="text-xs">
                From email
              </Label>
              <Input
                id="smtp-from-email"
                value={form.fromEmail}
                onChange={(e) => setForm((p) => ({ ...p, fromEmail: e.target.value }))}
                placeholder={providerCfg.userPlaceholder}
              />
            </div>
            <div>
              <Label htmlFor="smtp-from-name" className="text-xs">
                From name (optional)
              </Label>
              <Input
                id="smtp-from-name"
                value={form.fromName}
                onChange={(e) => setForm((p) => ({ ...p, fromName: e.target.value }))}
                placeholder="DealFlow"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="whitespace-nowrap"
              onClick={onSave}
              disabled={
                !form.user.trim() || !form.fromEmail.trim() || !form.pass.trim() || update.isPending
              }
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
            {view?.configured && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="whitespace-nowrap"
                onClick={onClear}
                disabled={update.isPending}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Test send. Hidden until a config is saved — you can't exercise an
              SMTP server you haven't configured. Recipient defaults to the
              registration email so the common "send to myself" case is one
              click. */}
          {view?.configured && (
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-3">
              <div className="min-w-[220px] flex-1">
                <Label htmlFor="smtp-test-to" className="text-xs">
                  Send test email to
                </Label>
                <Input
                  id="smtp-test-to"
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder={myEmail || 'recipient@example.com'}
                  data-testid="smtp-test-to"
                  className={
                    testTo.trim() && !isEmailLike(testTo)
                      ? 'border-red-300 ring-red-200'
                      : undefined
                  }
                />
                {testTo.trim() && !isEmailLike(testTo) && (
                  <p className="mt-1 text-[11px] text-red-600">
                    Looks like a typo — check for stray commas, missing <code>@</code>, or a bad
                    TLD. Should look like <code>name@domain.com</code>.
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="whitespace-nowrap"
                onClick={onTest}
                disabled={!isEmailLike(testTo) || test.isPending}
              >
                {test.isPending ? 'Sending test…' : 'Send test email'}
              </Button>
            </div>
          )}

          {/* Test result + smart-hint block. Lives BELOW the button row so long
              SMTP error messages wrap cleanly instead of pushing buttons around.
              Three states:
              1. Mutation threw (auth, network, validation): test.isError + test.error
              2. Backend returned ok=false (SMTP error caught upstream): test.data
              3. Backend returned ok=true: test.data
              We render all three so failures are never silently swallowed. */}
          {test.isError && !test.data && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium">✗ Test request failed before sending</p>
              <p className="mt-1 break-words font-mono text-xs">
                {test.error instanceof Error ? test.error.message : String(test.error)}
              </p>
              <p className="mt-2 text-xs">
                This usually means the recipient address didn't validate (check the field above for
                typos) or your session expired (sign out + back in). Browser DevTools console will
                show the full network error.
              </p>
            </div>
          )}
          {test.data && (
            <div className="mt-3">
              {test.data.ok ? (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  ✓ Test email sent to{' '}
                  <code className="rounded bg-white px-1 py-0.5 text-xs">
                    {testTo || view?.user}
                  </code>
                  . Check the inbox.
                </div>
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-medium">✗ Test failed</p>
                  <p className="mt-1 break-words font-mono text-xs">{test.data.error}</p>
                  <SmartHint error={test.data.error ?? ''} fromEmail={view?.fromEmail ?? ''} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Decode common SMTP failure modes into actionable, copy-pasteable hints.
 * Recognised patterns:
 *  - Gmail 534-5.7.9 "Application-specific password required" — needs an App Password
 *  - Gmail "Username and Password not accepted" — wrong password OR App Password expired
 *  - Outlook/SmtpAuth disabled — needs SMTP AUTH enabled in tenant settings
 *  - ENOTFOUND / getaddrinfo — bad SMTP_HOST
 *  - Common typo: smtp.gmail.com paired with a non-gmail.com from-email
 */
function SmartHint({ error, fromEmail }: { error: string; fromEmail: string }) {
  const hints: Array<{ key: string; node: React.ReactNode }> = [];

  const lower = error.toLowerCase();

  if (lower.includes('application-specific password') || lower.includes('5.7.9')) {
    hints.push({
      key: 'app-pw',
      node: (
        <>
          Gmail needs an <strong>App Password</strong>, not your regular Google password. Generate
          one at{' '}
          <a
            className="underline"
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noreferrer"
          >
            myaccount.google.com/apppasswords
          </a>{' '}
          (requires 2FA), then paste the 16-character code into the Password field above and Save
          again.
        </>
      ),
    });
  }

  if (
    lower.includes('username and password not accepted') ||
    lower.includes('invalid login') ||
    lower.includes('authentication failed')
  ) {
    hints.push({
      key: 'wrong-creds',
      node: (
        <>
          Username or password rejected by the SMTP server. Double-check there are no extra spaces,
          and that 2FA-enabled accounts (Gmail / Outlook) are using an App Password rather than the
          regular password.
        </>
      ),
    });
  }

  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
    hints.push({
      key: 'dns',
      node: (
        <>
          Couldn't reach the SMTP host. Check the Host field — common values are{' '}
          <code className="rounded bg-white px-1 py-0.5 text-xs">smtp.gmail.com</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 text-xs">smtp-mail.outlook.com</code>,{' '}
          <code className="rounded bg-white px-1 py-0.5 text-xs">smtp.mail.yahoo.com</code>.
        </>
      ),
    });
  }

  // Detect common Gmail-domain typos — gmai/gnail/gmial/gmal/gamil. Fires only on
  // misspellings, not on legitimate @gmail.com.
  const GMAIL_TYPOS = /@(?:gmai|gnail|gmial|gmal|gamil|gmaill)\.com$/i;
  if (fromEmail && GMAIL_TYPOS.test(fromEmail)) {
    hints.push({
      key: 'typo',
      node: (
        <>
          Your From email <code className="rounded bg-white px-1 py-0.5 text-xs">{fromEmail}</code>{' '}
          looks like a typo of{' '}
          <code className="rounded bg-white px-1 py-0.5 text-xs">@gmail.com</code>. Update both the
          Username and From email fields and Save again.
        </>
      ),
    });
  }

  if (hints.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1 text-xs text-red-900">
      {hints.map((h) => (
        <li key={h.key} className="rounded bg-white/60 p-2">
          {h.node}
        </li>
      ))}
    </ul>
  );
}
