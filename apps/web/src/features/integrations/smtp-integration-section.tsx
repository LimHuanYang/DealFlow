import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIntegrations, useTestEmail, useUpdateIntegrations } from './api';

interface SmtpFormState {
  host: string;
  port: string;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

const EMPTY: SmtpFormState = {
  host: '',
  port: '587',
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
  useEffect(() => {
    const s = integrations.data?.smtp;
    if (!s || !s.configured) return;
    setForm((prev) => ({
      ...prev,
      host: s.host ?? '',
      port: String(s.port ?? 587),
      user: s.user ?? '',
      fromEmail: s.fromEmail ?? '',
      fromName: s.fromName ?? '',
    }));
  }, [integrations.data]);

  async function onSave() {
    if (!form.host.trim() || !form.user.trim() || !form.fromEmail.trim() || !form.pass.trim()) {
      return;
    }
    await update.mutateAsync({
      smtp: {
        host: form.host.trim(),
        port: Number(form.port),
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

  return (
    <section
      className="mt-4 rounded-md border border-neutral-200 p-4"
      data-testid="smtp-integration"
    >
      <h2 className="mb-3 text-base font-medium">Email (SMTP)</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Send email from your own Gmail / Outlook / mail server. For Gmail, enable 2FA then generate
        an{' '}
        <a
          href="https://myaccount.google.com/apppasswords"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          App Password
        </a>{' '}
        and use it as the password below.
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
            <div>
              <Label htmlFor="smtp-host" className="text-xs">
                Host
              </Label>
              <Input
                id="smtp-host"
                value={form.host}
                onChange={(e) => setForm((p) => ({ ...p, host: e.target.value }))}
                placeholder="smtp.gmail.com"
                data-testid="smtp-host"
              />
            </div>
            <div>
              <Label htmlFor="smtp-port" className="text-xs">
                Port
              </Label>
              <Input
                id="smtp-port"
                value={form.port}
                onChange={(e) => setForm((p) => ({ ...p, port: e.target.value }))}
                placeholder="587"
              />
            </div>
            <div>
              <Label htmlFor="smtp-user" className="text-xs">
                Username
              </Label>
              <Input
                id="smtp-user"
                value={form.user}
                onChange={(e) => setForm((p) => ({ ...p, user: e.target.value }))}
                placeholder="you@gmail.com"
                data-testid="smtp-user"
              />
            </div>
            <div>
              <Label htmlFor="smtp-pass" className="text-xs">
                Password / App Password
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
                placeholder="you@gmail.com"
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

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={
                !form.host.trim() ||
                !form.user.trim() ||
                !form.fromEmail.trim() ||
                !form.pass.trim() ||
                update.isPending
              }
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onTest}
              disabled={!view?.configured || test.isPending}
            >
              {test.isPending ? 'Sending test…' : 'Send test email to me'}
            </Button>
            {view?.configured && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onClear}
                disabled={update.isPending}
              >
                Clear
              </Button>
            )}
            {test.data?.ok && <span className="text-xs text-green-700">✓ Sent</span>}
            {test.data && !test.data.ok && (
              <span className="text-xs text-red-600">✗ {test.data.error}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
