import type { PublicEmailAttachment } from '@dealflow/shared';
import { downloadAttachment } from '@/lib/api';

interface Props {
  attachments: PublicEmailAttachment[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailAttachmentsList({ attachments }: Props) {
  if (attachments.length === 0) return null;

  async function onDownload(att: PublicEmailAttachment) {
    if (!att.cached) {
      window.alert(
        "This attachment is no longer cached. Open your email provider's Sent folder to retrieve it.",
      );
      return;
    }
    try {
      const result = await downloadAttachment(att.id);
      if ('notCached' in result) {
        window.alert("Cache miss — retrieve from your email provider's Sent folder.");
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert('Download failed. Try again or get the file from your Sent folder.');
    }
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-neutral-400">
        Attachments ({attachments.length})
      </h2>
      <ul className="mt-2 divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
        {attachments.map((att) => (
          <li key={att.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="text-base">{att.mimeType.startsWith('image/') ? '🖼️' : '📄'}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-neutral-900">{att.filename}</div>
              <div className="text-xs text-neutral-500">
                {formatSize(att.sizeBytes)} · {att.mimeType}
              </div>
            </div>
            {att.cached ? (
              <button
                type="button"
                onClick={() => void onDownload(att)}
                className="text-xs text-blue-600 hover:underline"
              >
                Download
              </button>
            ) : (
              <span
                className="text-xs text-neutral-400"
                title="Cache expired or never written — retrieve from your Sent folder"
              >
                In Sent folder
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
