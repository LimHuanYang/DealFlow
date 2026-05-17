import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createDealBodySchema, type CreateDealInput, type PublicPipeline } from '@dealflow/shared';
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

  async function onSubmit(values: CreateDealInput) {
    await mut.mutateAsync(values);
    reset();
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
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create deal'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
