import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  const [form, setForm] = useState<SmtpFormState>(EMPTY);

  // When integrations load, seed everything EXCEPT password (we never send it back).
  // The stored host is mapped back to one of the three supported provider keys.
  useEffect(() => {
    const s = integrations.data?.smtp;
    if (!s || !s.configured) return;
    setForm((prev) => ({
      ...prev,
      provider: detectProvider(s.host ?? undefined),
      user: s.user ?? '',
      fromEmail: s.fromEmail ?? '',
      fromName: s.fromName ?? '',
    }));
  }, [integrations.data]);

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
    await test.mutateAsync();
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap"
              onClick={onTest}
              disabled={!view?.configured || test.isPending}
            >
              {test.isPending ? 'Sending test…' : 'Send test email'}
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

          {/* Test result + smart-hint block. Lives BELOW the button row so long
              SMTP error messages wrap cleanly instead of pushing buttons around. */}
          {test.data && (
            <div className="mt-3">
              {test.data.ok ? (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  ✓ Test email sent. Check your inbox at{' '}
                  <code className="rounded bg-white px-1 py-0.5 text-xs">{view?.user}</code>.
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
