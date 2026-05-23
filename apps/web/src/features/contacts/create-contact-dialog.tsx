import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createContactBodySchema, type CreateContactInput } from '@dealflow/shared';
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
import { useAIStatus, useExtractContact } from '@/features/ai/api';
import { useCreateContact } from './api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';

interface CreateContactDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateContactDialog({ trigger, open, onOpenChange }: CreateContactDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const mut = useCreateContact();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateContactInput>({ resolver: zodResolver(createContactBodySchema) });

  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const [mode, setMode] = useState<'form' | 'paste'>('form');
  const [pasteText, setPasteText] = useState('');
  const aiStatus = useAIStatus();
  const extract = useExtractContact();

  async function onExtract() {
    const trimmed = pasteText.trim();
    if (!trimmed) return;
    const res = await extract.mutateAsync(trimmed);
    const e = res.extracted;
    if (e.firstName) setValue('firstName', e.firstName);
    if (e.lastName) setValue('lastName', e.lastName);
    if (e.email) setValue('email', e.email);
    if (e.title) setValue('title', e.title);
    setMode('form');
  }

  async function onSubmit(values: CreateContactInput) {
    await mut.mutateAsync({ ...values, customFields });
    reset();
    setCustomFields({});
    setOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
        </DialogHeader>
        {aiStatus.data?.enabled && (
          <div className="mb-3 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setMode('form')}
              className={mode === 'form' ? 'font-medium text-neutral-900' : 'text-neutral-500'}
            >
              Manual
            </button>
            <span className="text-neutral-300">·</span>
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={mode === 'paste' ? 'font-medium text-neutral-900' : 'text-neutral-500'}
            >
              ✨ Paste from text
            </button>
          </div>
        )}
        {mode === 'paste' && (
          <div className="mb-4 flex flex-col gap-2">
            <Label htmlFor="paste-text">
              Paste an email signature, LinkedIn snippet, or freeform text
            </Label>
            <textarea
              id="paste-text"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              data-testid="paste-text"
            />
            <Button
              type="button"
              size="sm"
              onClick={onExtract}
              disabled={!pasteText.trim() || extract.isPending}
            >
              {extract.isPending ? 'Extracting…' : 'Extract fields'}
            </Button>
            {extract.isError && (
              <p className="text-sm text-red-600">Couldn't extract — please try again.</p>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" {...register('firstName')} autoFocus />
              {errors.firstName && (
                <p className="text-sm text-red-600">{errors.firstName.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" {...register('lastName')} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...register('title')} placeholder="e.g., CEO" />
          </div>
          <CustomFieldsBlock
            entityType="contact"
            values={customFields}
            onChange={(fieldId, value) => setCustomFields((prev) => ({ ...prev, [fieldId]: value }))}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create contact'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
