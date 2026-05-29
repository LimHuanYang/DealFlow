import { useState } from 'react';
import { toast } from 'sonner';
import type { PublicEmailAttachment } from '@dealflow/shared';
import { downloadAttachment } from '@/lib/api';
import { AttachmentPreviewDialog, isPreviewable } from './attachment-preview-dialog';

interface Props {
  attachments: PublicEmailAttachment[];
}

interface PreviewState {
  filename: string;
  mimeType: string;
  url: string | null;
  loading: boolean;
  message?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailAttachmentsList({ attachments }: Props) {
  const [preview, setPreview] = useState<PreviewState | null>(null);

  if (attachments.length === 0) return null;

  async function onDownload(att: PublicEmailAttachment) {
    if (!att.cached) {
      toast.warning(
        "This attachment is no longer cached. Open your email provider's Sent folder to retrieve it.",
      );
      return;
    }
    try {
      const result = await downloadAttachment(att.id);
      if ('notCached' in result) {
        toast.warning("Cache miss — retrieve from your email provider's Sent folder.");
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
      toast.error('Download failed. Try again or get the file from your Sent folder.');
    }
  }

  async function onPreview(att: PublicEmailAttachment) {
    setPreview({ filename: att.filename, mimeType: att.mimeType, url: null, loading: true });
    try {
      const result = await downloadAttachment(att.id);
      if ('notCached' in result) {
        setPreview({
          filename: att.filename,
          mimeType: att.mimeType,
          url: null,
          loading: false,
          message: "Cache miss — retrieve from your email provider's Sent folder.",
        });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      setPreview({ filename: att.filename, mimeType: att.mimeType, url, loading: false });
    } catch {
      toast.error('Could not load preview. Try again or get the file from your Sent folder.');
      setPreview(null);
    }
  }

  function onPreviewOpenChange(open: boolean) {
    if (!open) {
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
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
              <>
                {isPreviewable(att.mimeType) && (
                  <button
                    type="button"
                    onClick={() => void onPreview(att)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Preview
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onDownload(att)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Download
                </button>
              </>
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
      {preview && (
        <AttachmentPreviewDialog
          open
          onOpenChange={onPreviewOpenChange}
          filename={preview.filename}
          mimeType={preview.mimeType}
          url={preview.url}
          loading={preview.loading}
          message={preview.message}
        />
      )}
    </section>
  );
}
