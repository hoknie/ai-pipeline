import { GripVertical, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../shared/lib/browser/cn.ts';
import type { useListDrag } from '../../../../shared/lib/browser/useListDrag.ts';
import { Button } from '../../../../shared/ui/forms/button.tsx';

/** One action of a point: the grip to drag it, its name, and removing it. */
export function ActionRow({
  actionId,
  name,
  known,
  index,
  list,
  disabled,
  drag,
  onList,
}: {
  actionId: string;
  name: string;
  known: boolean;
  index: number;
  list: string[];
  disabled: boolean;
  drag: ReturnType<typeof useListDrag>;
  onList: (list: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <li
      className={cn(
        'flex items-center gap-2 text-sm',
        drag.dragging === actionId && 'opacity-50',
        drag.drop?.index === index &&
          (drag.drop.after ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
      )}
      data-id={actionId}
      tabIndex={0}
      draggable={!disabled}
      aria-label={`${index + 1}. ${name}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', actionId);
        event.dataTransfer.effectAllowed = 'move';
        drag.setDragging(actionId);
      }}
      onDragOver={(event) => drag.onDragOver(event, index)}
      onDrop={(event) => drag.onDrop(event, index)}
      onDragEnd={drag.onDragEnd}
      onKeyDown={(event) => {
        if (!disabled) drag.onKeyDown(event, actionId, index);
      }}
    >
      <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden="true">
        <title>{t('pipeline.points.drag')}</title>
      </GripVertical>
      <span className="min-w-0 flex-1 truncate" title={actionId}>
        {name}
        {!known ? (
          <span className="text-destructive"> ({t('pipeline.points.missing')})</span>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('pipeline.points.remove', { id: actionId })}
        disabled={disabled}
        onClick={() => onList(list.filter((_, at) => at !== index))}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
