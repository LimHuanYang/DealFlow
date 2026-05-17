import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { PublicDeal, PublicPipelineStage } from '@dealflow/shared';
import { Button } from '@/components/ui/button';
import { DealCard } from './deal-card';

interface KanbanColumnProps {
  stage: PublicPipelineStage;
  deals: PublicDeal[];
  onCreate: (stageId: string) => void;
}

export function KanbanColumn({ stage, deals, onCreate }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage:${stage.id}`,
    data: { type: 'stage', stageId: stage.id },
  });
  const dealIds = deals.map((d) => d.id);

  return (
    <section className="flex h-full w-72 shrink-0 flex-col rounded-md border border-neutral-200 bg-neutral-50">
      <header className="border-b border-neutral-200 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">{stage.name}</h2>
          <span className="text-xs text-neutral-500">{deals.length}</span>
        </div>
        {stage.winProbability != null && (
          <div className="mt-0.5 text-[11px] text-neutral-400">
            {stage.winProbability}% probability
          </div>
        )}
      </header>

      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 overflow-y-auto p-2 transition-colors ${
          isOver ? 'bg-indigo-50' : ''
        }`}
      >
        <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} />
          ))}
        </SortableContext>
      </div>

      <footer className="border-t border-neutral-200 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-neutral-500 hover:text-neutral-900"
          onClick={() => onCreate(stage.id)}
        >
          + Add deal
        </Button>
      </footer>
    </section>
  );
}
