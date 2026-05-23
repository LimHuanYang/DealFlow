import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createDealBodySchema,
  CURRENCY_OPTIONS,
  isSupportedCurrency,
  type CreateDealInput,
  type PublicPipeline,
} from '@dealflow/shared';
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
import { useCreateDeal } from './api';
import { useCurrentOrg } from '@/features/organizations/api';
import { CustomFieldsBlock } from '@/features/custom-fields/custom-fields-block';

interface CreateDealDialogProps {
  pipeline: PublicPipeline;
  defaultStageId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function CreateDealDialog({
  pipeline,
  defaultStageId,
  open,
  onOpenChange,
  trigger,
}: CreateDealDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const orgQuery = useCurrentOrg();
  const orgCurrency = orgQuery.data?.organization.defaultCurrency;

  const mut = useCreateDeal();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateDealInput>({
    resolver: zodResolver(createDealBodySchema),
    defaultValues: {
      pipelineId: pipeline.id,
      stageId: defaultStageId ?? pipeline.stages[0]?.id,
    },
  });

  useEffect(() => {
    setValue('pipelineId', pipeline.id);
    setValue('stageId', defaultStageId ?? pipeline.stages[0]?.id ?? '');
  }, [pipeline.id, defaultStageId, pipeline.stages, setValue]);

  // Once the current org loads, seed the currency field with the org's
  // preference. Users can override per-deal via the dropdown before submit.
  useEffect(() => {
    if (orgCurrency && isSupportedCurrency(orgCurrency)) {
      setValue('currency', orgCurrency);
    }
  }, [orgCurrency, setValue]);

  async function onSubmit(values: CreateDealInput) {
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
          <DialogTitle>New deal</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <input type="hidden" {...register('pipelineId')} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} autoFocus />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stageId">Stage</Label>
            <select
              id="stageId"
              {...register('stageId')}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
            >
              {pipeline.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="value">Value (optional)</Label>
            <Input id="value" type="number" min={0} {...register('value')} placeholder="0" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="currency">Currency</Label>
            <select
              id="currency"
              {...register('currency')}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
              data-testid="create-deal-currency-select"
            >
              {CURRENCY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <CustomFieldsBlock
            entityType="deal"
            values={customFields}
            onChange={(fieldId, value) => setCustomFields((prev) => ({ ...prev, [fieldId]: value }))}
          />
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create deal'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
