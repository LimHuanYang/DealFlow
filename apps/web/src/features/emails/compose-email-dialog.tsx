import { useState } from 'react';
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
import { useAIStatus } from '@/features/ai/api';
import { useDraftEmail, useSendEmail } from './api';

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
    await send.mutateAsync({ contactId, subject: subject.trim(), body: body.trim() });
    setSubject('');
    setBody('');
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email {recipientName}</DialogTitle>
          <p className="text-xs text-neutral-500">{recipientEmail}</p>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {aiStatus.data?.enabled && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowDraftPanel((v) => !v)}
                className="text-xs font-medium text-amber-700 hover:text-amber-900"
                data-testid="ai-draft-toggle"
              >
                {showDraftPanel ? 'Hide AI draft' : '✨ AI draft'}
              </button>
            </div>
          )}
          {showDraftPanel && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
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
              rows={10}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              data-testid="email-body"
            />
          </div>
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
  );
}
