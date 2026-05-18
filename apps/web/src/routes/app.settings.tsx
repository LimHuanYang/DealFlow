import { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CURRENCY_OPTIONS, type CurrencyCode } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useCurrentOrg, useUpdateOrg } from '@/features/organizations/api';

export const Route = createFileRoute('/app/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const orgQuery = useCurrentOrg();
  const update = useUpdateOrg();
  const [currency, setCurrency] = useState<CurrencyCode | ''>('');
  const [saved, setSaved] = useState(false);

  // Initialise the local form value from the server response when it lands.
  useEffect(() => {
    if (orgQuery.data?.organization.defaultCurrency) {
      setCurrency(orgQuery.data.organization.defaultCurrency as CurrencyCode);
    }
  }, [orgQuery.data?.organization.defaultCurrency]);

  if (orgQuery.isPending) {
    return <main className="p-6 text-sm text-neutral-500">Loading…</main>;
  }
  if (orgQuery.error || !orgQuery.data) {
    return <main className="p-6 text-sm text-red-600">Could not load organization.</main>;
  }

  const org = orgQuery.data.organization;
  const dirty = currency && currency !== org.defaultCurrency;

  async function onSave() {
    if (!dirty || !currency) return;
    setSaved(false);
    await update.mutateAsync({ defaultCurrency: currency });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
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
          {saved && <span className="text-sm text-green-600">Saved</span>}
          {update.isError && (
            <span className="text-sm text-red-600">Couldn't save — please try again.</span>
          )}
        </div>
      </section>
    </main>
  );
}
