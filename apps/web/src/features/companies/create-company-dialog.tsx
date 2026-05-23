import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createCompanyBodySchema, type CreateCompanyInput } from '@dealflow/shared';
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
import { useCreateCompany } from './api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';

interface CreateCompanyDialogProps {
  trigger?: React.ReactNode;
  /** Controlled open state, for command-palette invocation. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateCompanyDialog({ trigger, open, onOpenChange }: CreateCompanyDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const mut = useCreateCompany();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCompanyInput>({ resolver: zodResolver(createCompanyBodySchema) });

  async function onSubmit(values: CreateCompanyInput) {
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
          <DialogTitle>New company</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} autoFocus />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="domain">Domain</Label>
            <Input id="domain" {...register('domain')} placeholder="example.com" />
          </div>
          <CustomFieldsBlock
            entityType="company"
            values={customFields}
            onChange={(fieldId, value) => setCustomFields((prev) => ({ ...prev, [fieldId]: value }))}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create company'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
