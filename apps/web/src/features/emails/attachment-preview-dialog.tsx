import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Types we can render inline. Everything else falls back to download. */
export function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf';
}

interface AttachmentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  mimeType: string;
  /** Object URL for the file bytes, or null while loading / when unavailable. */
  url: string | null;
  /** True while the bytes are being fetched from the server. */
  loading?: boolean;
  /** When set, shown instead of a preview (e.g. cache miss). */
  message?: string;
  /** Optional download action shown for non-previewable types. */
  onDownload?: () => void;
}

/**
 * Renders an image or PDF inline in a modal. For anything else it offers a
 * Download button (browsers can't render Office files without a converter).
 * The parent owns the object URL — create it before opening and revoke it in
 * the onOpenChange(false) handler to avoid leaks.
 */
export function AttachmentPreviewDialog({
  open,
  onOpenChange,
  filename,
  mimeType,
  url,
  loading,
  message,
  onDownload,
}: AttachmentPreviewDialogProps) {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{filename}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[200px] items-center justify-center">
          {message ? (
            <p className="text-sm text-neutral-500">{message}</p>
          ) : loading ? (
            <p className="text-sm text-neutral-500">Loading preview…</p>
          ) : !url ? null : isImage ? (
            <img src={url} alt={filename} className="mx-auto max-h-[70vh] max-w-full rounded" />
          ) : isPdf ? (
            <iframe src={url} title={filename} className="h-[70vh] w-full rounded border" />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-neutral-500">No preview available for this file type.</p>
              {onDownload && (
                <Button type="button" size="sm" onClick={onDownload}>
                  Download
                </Button>
              )}
            </div>
          )}
        </div>
        {isPdf && url && !message && (
          <div className="flex justify-end">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Open in new tab
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
