import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ATTACHMENT_CACHE_DAYS, type AttachmentCacheDays } from '@dealflow/shared';
import { useIntegrations, useUpdateIntegrations } from './api';

const LABELS: Record<AttachmentCacheDays, string> = {
  '7': '7 days',
  '30': '30 days',
  '90': '90 days',
  never: 'Forever (keep all attachments)',
};

export function EmailSettingsSection() {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  const [days, setDays] = useState<AttachmentCacheDays>('30');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const v = integrations.data?.email?.attachmentCacheDays;
    if (v) setDays(v);
  }, [integrations.data]);

  const current = integrations.data?.email?.attachmentCacheDays ?? '30';
  const dirty = current !== days;

  async function onSave() {
    setSaved(false);
    await update.mutateAsync({ email: { attachmentCacheDays: days } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section
      className="mt-4 rounded-md border border-neutral-200 p-4"
      data-testid="email-settings"
    >
      <h2 className="mb-1 text-base font-medium">Email attachments</h2>
      <p className="mb-3 text-sm text-neutral-500">
        How long DealFlow keeps sent-email attachments cached locally for fast re-download.
        After this window, files are removed and you retrieve them from your email
        provider&apos;s Sent folder.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="attachment-cache-days">Keep cached attachments for&hellip;</Label>
        <select
          id="attachment-cache-days"
          value={days}
          onChange={(e) => setDays(e.target.value as AttachmentCacheDays)}
          className="h-9 w-full max-w-sm rounded-md border border-neutral-200 bg-white px-3 text-sm"
          data-testid="attachment-cache-days"
        >
          {ATTACHMENT_CACHE_DAYS.map((v) => (
            <option key={v} value={v}>
              {LABELS[v]}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={onSave} disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
        {update.isError && (
          <span className="text-sm text-red-600">Couldn&apos;t save &mdash; please try again.</span>
        )}
      </div>
    </section>
  );
}
