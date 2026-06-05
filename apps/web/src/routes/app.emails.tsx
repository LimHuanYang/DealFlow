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
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Emails</h1>
        <p className="text-sm text-slate-500">
          Track sent emails, opens, and clicks across your org.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm"
        >
          <option value="all">All</option>
          <option value="opened">Opened</option>
          <option value="clicked">Clicked</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as typeof range)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm"
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
          className="h-9 max-w-xs flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm placeholder:text-slate-400 focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>

      {list.isPending && <p className="text-sm text-slate-500">Loading...</p>}
      {list.data && list.data.items.length === 0 && (
        <p className="text-sm text-slate-400">No sent emails match your filters.</p>
      )}
      {list.data && list.data.items.length > 0 && (
        <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
          <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Sent</th>
              <th className="px-4 py-2.5 text-left font-medium">Recipient</th>
              <th className="px-4 py-2.5 text-left font-medium">Subject</th>
              <th className="px-4 py-2.5 text-left font-medium">Engagement</th>
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
                className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                  {new Date(e.sentAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-slate-700">
                  {e.recipientName ?? e.recipientEmail ?? '—'}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {e.subject ?? '(no subject)'}
                </td>
                <td className="px-4 py-2.5">
                  {e.deliveryStatus === 'failed' && <span className="text-red-600">⚠ failed</span>}
                  {e.deliveryStatus === 'sent' && e.openCount === 0 && e.clickCount === 0 && (
                    <span className="text-slate-400">📤 sent</span>
                  )}
                  {e.openCount > 0 && <span className="mr-2 text-green-600">👁 {e.openCount}</span>}
                  {e.clickCount > 0 && <span className="text-indigo-600">🖱 {e.clickCount}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
