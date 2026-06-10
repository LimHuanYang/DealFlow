import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getMe } from '@/lib/auth';
import { queryKeys } from '@/lib/query-keys';
import { useEmailIntegration, useTestEmail, useUpdateEmailIntegration } from './api';

/** Light client-side email-shape check; the server does authoritative validation. */
function isEmailLike(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.,]{2,}$/.test(raw.trim());
}

interface FormState {
  fromName: string;
  fromEmail: string;
}

const EMPTY: FormState = { fromName: '', fromEmail: '' };

/**
 * EngineMailer email integration. The EngineMailer API key is a single
 * app-wide server setting (ENGINE_MAILER_API_KEY) — one account for the whole
 * deployment — so this section only sets the org's sender identity (From name +
 * From email). `fromEmail`'s domain must be verified in EngineMailer. Opens and
 * clicks arrive via a server-side webhook (no tracking pixel).
 */
export function EmailIntegrationSection() {
  const integration = useEmailIntegration();
  const update = useUpdateEmailIntegration();
  const test = useTestEmail();

  const meQuery = useQuery({ queryKey: queryKeys.me, queryFn: getMe });
  const myEmail = meQuery.data?.user?.email ?? '';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [testTo, setTestTo] = useState<string>('');

  // Seed From fields from the saved config; for a fresh org prefill From email
  // from the registration email so Save is one click away.
  useEffect(() => {
    const d = integration.data;
    if (!d) return;
    setForm((prev) => ({
      fromName: prev.fromName || d.fromName || '',
      fromEmail: prev.fromEmail || d.fromEmail || myEmail || '',
    }));
  }, [integration.data, myEmail]);

  useEffect(() => {
    if (myEmail && !testTo) setTestTo(myEmail);
  }, [myEmail, testTo]);

  const d = integration.data;
  const apiKeyConfigured = d?.apiKeyConfigured ?? false;
  const connected = d?.connected ?? false;
  const canSave = Boolean(form.fromName.trim()) && isEmailLike(form.fromEmail) && !update.isPending;

  async function onSave() {
    if (!canSave) return;
    await update.mutateAsync({ fromName: form.fromName.trim(), fromEmail: form.fromEmail.trim() });
  }

  async function onTest() {
    const to = testTo.trim();
    try {
      await test.mutateAsync(to ? { to } : {});
    } catch (err) {
      console.error('[engine-mailer test-email] request failed:', err);
    }
  }

  return (
    <section
      className="mt-4 rounded-md border border-neutral-200 p-4"
      data-testid="email-integration"
    >
      <h2 className="mb-3 text-base font-medium">Email (EngineMailer)</h2>
      <p className="mb-4 text-sm text-neutral-500">
        DealFlow sends &amp; tracks email through EngineMailer. Opens and clicks are reported
        automatically via webhook — no tracking pixel. The EngineMailer account is configured once
        for the whole app; here you just set how email from your organization appears.
      </p>

      {integration.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {d && (
        <>
          {!apiKeyConfigured ? (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ EngineMailer isn&apos;t set up on the server yet (missing{' '}
              <code>ENGINE_MAILER_API_KEY</code>). Email sending is disabled until the app owner adds
              it. You can still save your sender details below.
            </p>
          ) : connected ? (
            <p className="mb-3 text-xs text-green-700">
              ✓ Connected · sending as <code>{d.fromEmail}</code>
            </p>
          ) : (
            <p className="mb-3 text-xs text-neutral-400">Add your sender details below to start.</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="em-from-name" className="text-xs">
                From name
              </Label>
              <Input
                id="em-from-name"
                value={form.fromName}
                onChange={(e) => setForm((p) => ({ ...p, fromName: e.target.value }))}
                placeholder="Acme Sales"
                data-testid="em-from-name"
              />
            </div>
            <div>
              <Label htmlFor="em-from-email" className="text-xs">
                From email
              </Label>
              <Input
                id="em-from-email"
                value={form.fromEmail}
                onChange={(e) => setForm((p) => ({ ...p, fromEmail: e.target.value }))}
                placeholder="crm@yourdomain.com"
                data-testid="em-from-email"
                className={
                  form.fromEmail.trim() && !isEmailLike(form.fromEmail)
                    ? 'border-red-300 ring-red-200'
                    : undefined
                }
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                Must be on a domain verified in EngineMailer.
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="whitespace-nowrap"
              onClick={onSave}
              disabled={!canSave}
            >
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>

          {update.isError && (
            <p className="mt-2 text-xs text-red-600">
              {update.error instanceof Error ? update.error.message : 'Save failed'}
            </p>
          )}

          {/* Tracking webhook setup hint. */}
          <div className="mt-4 rounded-md border border-neutral-100 bg-neutral-50 p-3 text-xs text-neutral-600">
            <p className="font-medium text-neutral-700">Open &amp; click tracking</p>
            <p className="mt-1">
              In EngineMailer → <strong>Domains › your domain › Webhooks</strong>, point the{' '}
              <strong>Open</strong> and <strong>Click</strong> events at your DealFlow webhook URL:
            </p>
            <code className="mt-1 block whitespace-pre-wrap break-all rounded bg-white px-2 py-1">
              {'<your-api-domain>'}/api/v1/webhooks/engine-mailer?key={'<ENGINE_MAILER_WEBHOOK_SECRET>'}
            </code>
          </div>

          {/* Test send — shown once fully connected. */}
          {connected && (
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-3">
              <div className="min-w-[220px] flex-1">
                <Label htmlFor="em-test-to" className="text-xs">
                  Send test email to
                </Label>
                <Input
                  id="em-test-to"
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder={myEmail || 'recipient@example.com'}
                  data-testid="em-test-to"
                  className={
                    testTo.trim() && !isEmailLike(testTo) ? 'border-red-300 ring-red-200' : undefined
                  }
                />
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

          {test.data && (
            <div className="mt-3">
              {test.data.ok ? (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  ✓ Test email sent to{' '}
                  <code className="rounded bg-white px-1 py-0.5 text-xs">{testTo || d.fromEmail}</code>
                  . Check the inbox.
                </div>
              ) : (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-medium">✗ Test failed</p>
                  <p className="mt-1 break-words font-mono text-xs">{test.data.error}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
