import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEmailsList } from '@/features/emails/api';

export const Route = createFileRoute('/app/emails')({
  component: EmailsDashboardPage,
});

function EmailsDashboardPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'all' | 'opened' | 'clicked' | 'failed'>('all');
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('7d');
  const [q, setQ] = useState('');
  const list = useEmailsList({ status, range, q: q || undefined });

  return (
    <main className="p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Emails</h1>
        <p className="text-sm text-neutral-500">
          Track sent emails, opens, and clicks across your org.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
        >
          <option value="all">All</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as typeof range)}
          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subject..."
          className="h-9 flex-1 max-w-xs rounded-md border border-neutral-200 bg-white px-3 text-sm"
        />
      </div>

      {list.isPending && <p className="text-sm text-neutral-500">Loading...</p>}
      {list.data && list.data.items.length === 0 && (
        <p className="text-sm text-neutral-400">No sent emails match your filters.</p>
      )}
      {list.data && list.data.items.length > 0 && (
        <table className="w-full overflow-hidden rounded-md border border-neutral-200 bg-white text-sm">
          <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Sent</th>
              <th className="px-3 py-2 text-left">Recipient</th>
              <th className="px-3 py-2 text-left">Subject</th>
              <th className="px-3 py-2 text-left">Engagement</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((e) => (
              <tr
                key={e.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate({ to: '/app/activities/$id', params: { id: e.id } })}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    void navigate({ to: '/app/activities/$id', params: { id: e.id } });
                  }
                }}
                className="cursor-pointer border-t border-neutral-100 transition-colors hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none"
              >
                <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                  {new Date(e.sentAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">{e.recipientName ?? e.recipientEmail ?? '—'}</td>
                <td className="px-3 py-2 font-medium text-neutral-900">
                  {e.subject ?? '(no subject)'}
                </td>
                <td className="px-3 py-2">
                  {e.deliveryStatus === 'failed' && <span className="text-red-700">⚠ failed</span>}
                  {e.deliveryStatus === 'sent' && e.openCount === 0 && e.clickCount === 0 && (
                    <span className="text-neutral-400">📤 sent</span>
                  )}
                  {e.openCount > 0 && <span className="mr-2 text-green-700">👁 {e.openCount}</span>}
                  {e.clickCount > 0 && <span className="text-blue-700">🖱 {e.clickCount}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
