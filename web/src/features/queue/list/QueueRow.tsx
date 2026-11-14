import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import type { PipelinesView, QueueItemView, QueueView } from '../../../shared/api/types.ts';
import { TagChips } from '../../../shared/ui/feedback/TagChip.tsx';
import { PipelineBadge } from '../../../shared/ui/feedback/PipelineBadge.tsx';
import { VariantBadge } from '../../../shared/ui/feedback/VariantBadge.tsx';
import type { QueueDraft } from '../QueueForm.tsx';
import { depth, type ParentChoice } from '../queueLinks.ts';
import { itemLabel } from './itemText.ts';
import { RowActions } from './RowActions.tsx';
import { RowMeta, RowStatus } from './RowBadges.tsx';
import { RowDetails } from './RowDetails.tsx';
import type { QueueDrag } from './useQueueDrag.ts';
import type { useQueueActions } from './useQueueActions.ts';

export type RowProps = {
  api: Api;
  queue: QueueView;
  item: QueueItemView;
  index: number;
  pipelines: PipelinesView | null;
  parents: ParentChoice[];
  now: number;
  editing: QueueDraft | undefined;
  highlighted: boolean;
  onHighlight: (id: string | null) => void;
  drag: QueueDrag;
  actions: ReturnType<typeof useQueueActions>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
};

/** One item of the queue: its line, the buttons, and what hangs under it. */
export function QueueRow(props: RowProps) {
  const { t } = useTranslation();
  const { item, index, queue, drag, editing, onHighlight } = props;
  const level = depth(queue, item.id);
  const postponed = props.actions.pending[item.id] ?? item.postponed === true;
  const linked = drag.dragging === null && props.highlighted;
  return (
    <li
      className={cn(
        'rounded-lg border bg-card p-2.5',
        level > 0 && 'border-l-4 border-l-primary/50',
        item.readiness === 'blocked' && 'border-destructive',
        linked && 'ring-2 ring-primary',
        drag.dragging === item.id && 'opacity-50',
        (postponed || item.filtered) && 'opacity-60',
        drag.drop?.index === index &&
          (drag.drop.after ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
      )}
      data-id={item.id}
      data-depth={level}
      data-highlighted={linked ? '' : undefined}
      style={level > 0 ? { marginLeft: `${level * 1.25}rem` } : undefined}
      tabIndex={0}
      onMouseEnter={() => drag.dragging === null && onHighlight(item.id)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => drag.dragging === null && onHighlight(item.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHighlight(null);
      }}
      draggable={!editing}
      aria-label={`${index + 1}. ${itemLabel(item, t)}`}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', item.id);
        event.dataTransfer.effectAllowed = 'move';
        onHighlight(null);
        drag.setDragging(item.id);
      }}
      onDragOver={(event) => drag.onDragOver(event, index)}
      onDrop={(event) => drag.onDrop(event, index)}
      onDragEnd={drag.onDragEnd}
      onKeyDown={(event) => drag.onKeyDown(event, item, index)}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden="true">
          <title>{t('queue.list.drag')}</title>
        </GripVertical>
        <span className="w-5 text-muted-foreground tabular-nums">{index + 1}</span>
        <span className="font-mono text-xs text-muted-foreground">{taskNumber(item.number)}</span>
        <PipelineBadge id={item.pipeline} name={item.pipelineName} />
        <VariantBadge id={item.variant} name={item.variantName} />
        <span className="min-w-0 flex-1 truncate" title={itemLabel(item, t)}>
          {itemLabel(item, t)}
        </span>
        <TagChips tags={item.tags ?? []} />
        <RowStatus item={item} postponed={postponed} linked={linked} />
        <RowMeta item={item} pipelines={props.pipelines} now={props.now} />
        <RowActions
          item={item}
          queue={queue}
          editing={editing}
          postponed={postponed}
          actions={props.actions}
          onDraft={props.onDraft}
        />
      </div>
      <RowDetails {...props} editing={editing} />
    </li>
  );
}
