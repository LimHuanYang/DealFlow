import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { PublicDeal, PublicPipeline, PublicPipelineStage } from '@dealflow/shared';
import { KanbanColumn } from './kanban-column';
import { DealCard } from './deal-card';

interface KanbanBoardProps {
  pipeline: PublicPipeline;
  deals: PublicDeal[];
  onMove: (dealId: string, stageId: string, positionInStage: number) => void;
  onCreate: (stageId: string) => void;
}

export function KanbanBoard({ pipeline, deals, onMove, onCreate }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const dealsByStage = useMemo(() => {
    const byStage = new Map<string, PublicDeal[]>();
    for (const stage of pipeline.stages) byStage.set(stage.id, []);
    for (const d of deals) {
      const list = byStage.get(d.stageId);
      if (list) list.push(d);
    }
    for (const list of byStage.values()) {
      list.sort((a, b) => a.positionInStage - b.positionInStage);
    }
    return byStage;
  }, [pipeline.stages, deals]);

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeDealId = String(active.id);
    const activeStage = (active.data.current as { stageId: string } | undefined)?.stageId;

    let targetStageId: string;
    let targetIndex: number;
    const overId = String(over.id);
    if (overId.startsWith('stage:')) {
      targetStageId = overId.slice('stage:'.length);
      targetIndex = (dealsByStage.get(targetStageId) ?? []).length;
    } else {
      const overData = over.data.current as
        | { type?: string; stageId?: string; positionInStage?: number }
        | undefined;
      targetStageId = overData?.stageId ?? activeStage ?? pipeline.stages[0]!.id;
      const targetCol = dealsByStage.get(targetStageId) ?? [];
      targetIndex = targetCol.findIndex((d) => d.id === overId);
      if (targetIndex < 0) targetIndex = targetCol.length;
    }

    const column = (dealsByStage.get(targetStageId) ?? []).filter((d) => d.id !== activeDealId);
    const before = column[targetIndex - 1]?.positionInStage;
    const after = column[targetIndex]?.positionInStage;
    let newPosition: number;
    if (before == null && after == null) newPosition = 1;
    else if (before == null) newPosition = after! - 1;
    else if (after == null) newPosition = before + 1;
    else newPosition = (before + after) / 2;

    onMove(activeDealId, targetStageId, newPosition);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {pipeline.stages.map((stage: PublicPipelineStage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            deals={dealsByStage.get(stage.id) ?? []}
            onCreate={onCreate}
          />
        ))}
      </div>
      <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} /> : null}</DragOverlay>
    </DndContext>
  );
}
