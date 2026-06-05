import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAIStatus } from '@/features/ai/api';
import { useDraftEmail, useSendEmail } from './api';
import { AttachmentPreviewDialog, isPreviewable } from './attachment-preview-dialog';

interface ComposeEmailDialogProps {
  contactId: string;
  /** Display name for the recipient — used only in the dialog title. */
  recipientName: string;
  /** Email address — used to show the operator who they're emailing. */
  recipientEmail: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function parseEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@.,]{2,}$/.test(s));
}

/**
 * Dialog that sends an email to a single contact. Optional AI Draft button
 * (visible when AI is enabled) generates a subject + body from a short intent
 * string the user types.
 */
export function ComposeEmailDialog({
  contactId,
  recipientName,
  recipientEmail,
  trigger,
  open,
  onOpenChange,
}: ComposeEmailDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState('');
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [trackEnabled, setTrackEnabled] = useState(true);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [preview, setPreview] = useState<{
    url: string;
    filename: string;
    mimeType: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalBytes = attachments.reduce((sum, f) => sum + f.size, 0);
  const MAX_TOTAL = 25 * 1024 * 1024;
  const MAX_FILE = 25 * 1024 * 1024;

  function addFiles(newFiles: FileList | File[]) {
    const incoming = Array.from(newFiles);
    const accepted: File[] = [];
    for (const f of incoming) {
      if (f.size > MAX_FILE) {
        toast.error(`${f.name} is larger than 25 MB and was skipped.`);
        continue;
      }
      const projected = totalBytes + accepted.reduce((s, a) => s + a.size, 0) + f.size;
      if (projected > MAX_TOTAL) {
        toast.error(`Total attachment size would exceed 25 MB. ${f.name} skipped.`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function openPreview(f: File) {
    setPreview({ url: URL.createObjectURL(f), filename: f.name, mimeType: f.type });
  }

  function onPreviewOpenChange(open: boolean) {
    if (!open) {
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  function onPaste(e: React.ClipboardEvent<HTMLFormElement>) {
    if (!e.clipboardData?.files?.length) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  const send = useSendEmail();
  const draft = useDraftEmail();
  const aiStatus = useAIStatus();

  async function onDraft() {
    const trimmed = intent.trim();
    if (!trimmed) return;
    const res = await draft.mutateAsync({ contactId, intent: trimmed });
    setSubject(res.subject);
    setBody(res.body);
    setShowDraftPanel(false);
    setIntent('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    const ccList = parseEmails(cc);
    const bccList = parseEmails(bcc);
    await send.mutateAsync({
      contactId,
      subject: subject.trim(),
      body: body.trim(),
      ...(ccList.length > 0 ? { cc: ccList } : {}),
      ...(bccList.length > 0 ? { bcc: bccList } : {}),
      trackEnabled,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    setSubject('');
    setBody('');
    setCc('');
    setBcc('');
    setShowCcBcc(false);
    setTrackEnabled(true);
    setAttachments([]);
    setOpen(false);
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <DialogTitle>Email {recipientName}</DialogTitle>
                <p className="mt-1 truncate text-sm text-slate-500">To: {recipientEmail}</p>
              </div>
              {aiStatus.data?.enabled && (
                <button
                  type="button"
                  onClick={() => setShowDraftPanel((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                  data-testid="ai-draft-toggle"
                >
                  {showDraftPanel ? 'Hide AI draft' : '✨ AI draft'}
                </button>
              )}
            </div>
          </DialogHeader>
          <form onSubmit={onSubmit} onPaste={onPaste} className="flex flex-col gap-4" noValidate>
            {showDraftPanel && (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <Label htmlFor="intent" className="text-amber-900">
                  What should the email do?
                </Label>
                <Input
                  id="intent"
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="e.g. follow up on the pricing discussion"
                  data-testid="ai-draft-intent"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={onDraft}
                  disabled={!intent.trim() || draft.isPending}
                >
                  {draft.isPending ? 'Drafting…' : 'Draft with AI'}
                </Button>
                {draft.isError && (
                  <p className="text-sm text-red-600">Couldn't draft — please try again.</p>
                )}
              </div>
            )}
            {!showCcBcc && (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="self-start text-xs font-medium text-primary hover:underline"
              >
                + Add Cc / Bcc
              </button>
            )}
            {showCcBcc && (
              <>
                <div className="mb-2">
                  <Label htmlFor="cc" className="text-xs">
                    Cc
                  </Label>
                  <Input
                    id="cc"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="comma-separated emails"
                  />
                </div>
                <div className="mb-2">
                  <Label htmlFor="bcc" className="text-xs">
                    Bcc
                  </Label>
                  <Input
                    id="bcc"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="comma-separated emails"
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                autoFocus
                data-testid="email-subject"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email-body">Message</Label>
              <textarea
                id="email-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                data-testid="email-body"
              />
            </div>
            <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              <div className="mb-1 flex items-center justify-between">
                <Label className="text-xs">Attachments</Label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-blue-600 hover:underline"
                >
                  + Attach files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
              {attachments.length > 0 && (
                <ul className="mb-1 divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white text-sm">
                  {attachments.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                      <span className="text-base">{f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-neutral-900">{f.name}</div>
                        <div className="text-xs text-neutral-500">{formatSize(f.size)}</div>
                      </div>
                      {isPreviewable(f.type) && (
                        <button
                          type="button"
                          onClick={() => openPreview(f)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Preview
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        className="text-neutral-400 hover:text-red-600"
                        aria-label={`Remove ${f.name}`}
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-xs text-neutral-500">
                {attachments.length === 0
                  ? 'Drop files here or paste images'
                  : `${attachments.length} file${attachments.length === 1 ? '' : 's'} · ${formatSize(totalBytes)} / 25 MB`}
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={trackEnabled}
                onChange={(e) => setTrackEnabled(e.target.checked)}
              />
              Track opens and clicks
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={!subject.trim() || !body.trim() || send.isPending}>
                {send.isPending ? 'Sending…' : 'Send email'}
              </Button>
            </div>
            {send.isError && (
              <p className="text-sm text-red-600">Couldn't send — please try again.</p>
            )}
          </form>
        </DialogContent>
      </Dialog>
      {preview && (
        <AttachmentPreviewDialog
          open
          onOpenChange={onPreviewOpenChange}
          filename={preview.filename}
          mimeType={preview.mimeType}
          url={preview.url}
        />
      )}
    </>
  );
}
