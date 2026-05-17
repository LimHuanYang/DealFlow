import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from '@tanstack/react-router';
import type { PublicDeal } from '@dealflow/shared';
import { formatCurrency, formatRelativeDate } from '@/lib/format';

interface DealCardProps {
  deal: PublicDeal;
}

export function DealCard({ deal }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { type: 'deal', stageId: deal.stageId, positionInStage: deal.positionInStage },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded-md border border-neutral-200 bg-white p-3 shadow-sm hover:shadow active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/app/deals/${deal.id}` as never}
          className="font-medium text-neutral-900 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {deal.name}
        </Link>
      </div>
      <div className="mt-1 text-sm text-neutral-700">
        {formatCurrency(deal.value, deal.currency)}
      </div>
      <div className="mt-2 text-xs text-neutral-400">
        Updated {formatRelativeDate(deal.updatedAt)}
      </div>
    </div>
  );
}
