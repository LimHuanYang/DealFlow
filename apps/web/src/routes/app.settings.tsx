import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  CURRENCY_OPTIONS,
  isSupportedCurrency,
  type CurrencyCode,
  type PublicOrganization,
} from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAIStatus } from '@/features/ai/api';
import { useCurrentOrg, useUpdateOrg } from '@/features/organizations/api';

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const orgQuery = useCurrentOrg();

  if (orgQuery.isPending) {
    return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  }
  if (orgQuery.error || !orgQuery.data) {
    return <main className="p-6 text-sm text-red-600">Could not load organization.</main>;
  }

  return <SettingsForm org={orgQuery.data.organization} />;
}

interface SettingsFormProps {
  org: PublicOrganization;
}

function SettingsForm({ org }: SettingsFormProps) {
  const update = useUpdateOrg();
  // Initialise from the server value. No useEffect-sync needed because the
  // parent already guards against rendering this component before data arrives.
  // The server always supplies a supported currency; fall back to USD only if the
  // string ever fails the runtime guard (e.g. an older row predating the constraint).
  const [currency, setCurrency] = useState<CurrencyCode>(
    isSupportedCurrency(org.defaultCurrency) ? org.defaultCurrency : 'USD',
  );
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const aiStatus = useAIStatus();

  // Clear any pending "Saved" timer when the component unmounts so we don't
  // call setState on an unmounted instance.
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const dirty = currency !== org.defaultCurrency;

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (isSupportedCurrency(next)) setCurrency(next);
  }

  async function onSave() {
    if (!dirty) return;
    setSaved(false);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    await update.mutateAsync({ defaultCurrency: currency });
    setSaved(true);
    timerRef.current = window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">{org.name}</p>

      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="mb-3 text-base font-medium">Default currency</h2>
        <p className="mb-4 text-sm text-neutral-500">
          New deals are created in this currency by default. Existing deals are not affected.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="defaultCurrency">Currency</Label>
          <select
            id="defaultCurrency"
            value={currency}
            onChange={onChange}
            className="h-9 w-full max-w-sm rounded-md border border-neutral-200 bg-white px-3 text-sm"
            data-testid="currency-select"
          >
            {CURRENCY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={onSave} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          <div role="status" aria-live="polite" className="text-sm">
            {saved && <span className="text-green-600">Saved</span>}
            {update.isError && (
              <span className="text-red-600">Couldn't save — please try again.</span>
            )}
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-md border border-neutral-200 p-4">
        <h2 className="mb-3 text-base font-medium">AI features</h2>
        {aiStatus.isPending && <p className="text-sm text-neutral-500">Checking…</p>}
        {aiStatus.data?.enabled ? (
          <>
            <p className="mb-2 text-sm text-neutral-700">
              <span className="font-medium text-green-700">Enabled</span> · fallback chain runs in
              order.
            </p>
            <ol className="ml-4 list-decimal space-y-1 text-sm text-neutral-700">
              {aiStatus.data.providers.map((p) => (
                <li key={p.name}>
                  <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">{p.name}</code>
                  {' · model '}
                  <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">{p.model}</code>
                </li>
              ))}
            </ol>
          </>
        ) : (
          aiStatus.data && (
            <p className="text-sm text-neutral-700">
              <span className="font-medium text-neutral-500">Disabled</span> — set any of{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code>,{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">GEMINI_API_KEY</code>, or{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">XAI_API_KEY</code> in{' '}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">apps/api/.env</code> to
              enable.
            </p>
          )
        )}
      </section>
    </main>
  );
}
