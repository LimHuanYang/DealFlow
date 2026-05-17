import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { KanbanBoard } from '@/components/kanban-board';
import { CreateDealDialog } from '@/features/deals/create-deal-dialog';
import { usePipelines } from '@/features/pipelines/api';
import { useDealsList, useMoveDeal } from '@/features/deals/api';

export const Route = createFileRoute('/app/deals/')({
  component: DealsKanbanPage,
});

function DealsKanbanPage() {
  const pipelinesQuery = usePipelines();
  const pipeline = pipelinesQuery.data?.pipelines[0];
  const pipelineId = pipeline?.id;
  const dealsQuery = useDealsList(pipelineId);
  const move = useMoveDeal(pipelineId);
  const [createDefaultStage, setCreateDefaultStage] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);

  if (pipelinesQuery.isPending) {
    return <main className="p-6 text-sm text-neutral-500">Loading pipeline…</main>;
  }
  if (pipelinesQuery.error || !pipeline) {
    return <main className="p-6 text-sm text-red-600">Could not load pipeline.</main>;
  }

  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <h1 className="text-2xl font-semibold tracking-tight">{pipeline.name}</h1>
        <CreateDealDialog
          pipeline={pipeline}
          defaultStageId={createDefaultStage}
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v);
            if (!v) setCreateDefaultStage(undefined);
          }}
          trigger={<Button onClick={() => setCreateOpen(true)}>New deal</Button>}
        />
      </div>
      {dealsQuery.isPending ? (
        <p className="p-4 text-sm text-neutral-500">Loading deals…</p>
      ) : (
        <KanbanBoard
          pipeline={pipeline}
          deals={dealsQuery.data?.items ?? []}
          onMove={(dealId, stageId, positionInStage) => {
            move.mutate({ id: dealId, stageId, positionInStage });
          }}
          onCreate={(stageId) => {
            setCreateDefaultStage(stageId);
            setCreateOpen(true);
          }}
        />
      )}
    </main>
  );
}
