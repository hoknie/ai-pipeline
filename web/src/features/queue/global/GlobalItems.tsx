import { GripVertical, ListOrdered } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { GlobalQueueItemView } from '../../../shared/api/types.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { useListDrag } from '../../../shared/lib/browser/useListDrag.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import { moveId } from '../../../shared/lib/listOrder.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { PipelineBadge } from '../../../shared/ui/feedback/PipelineBadge.tsx';
import { TagChips } from '../../../shared/ui/feedback/TagChip.tsx';
import { itemLabel } from '../list/itemText.ts';
import { ProjectLabel } from './ProjectLabel.tsx';

/** The shown order of the tasks: an own move first, the queue's truth once the daemon answers. */
function useGlobalOrder(
  api: Api,
  items: GlobalQueueItemView[],
  onError: (message: string) => void,
) {
  const [order, setOrder] = useState<string[] | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!inFlight.current) setOrder(null);
  }, [items]);
  const byId = new Map(items.map((item) => [item.id, item]));
  const shown = (order ?? items.map((item) => item.id))
    .map((id) => byId.get(id))
    .filter((item): item is GlobalQueueItemView => item !== undefined);
  const move = async (id: string, position: number) => {
    const ids = shown.map((item) => item.id);
    const from = ids.indexOf(id);
    const item = byId.get(id);
    if (!item || from === -1 || position < 1 || position > ids.length || position - 1 === from) {
      return;
    }
    setOrder(moveId(ids, from, position));
    inFlight.current = true;
    try {
      // the position is a place among the tasks of all projects
      await api.forRepository(item.repository).queueEdit(id, { position });
    } catch (error) {
      onError((error as Error).message);
    } finally {
      inFlight.current = false;
      setOrder(null);
    }
  };
  return { shown, move };
}

/** The waiting tasks of all projects in the global order; dragging moves a task by its global place. */
export function GlobalItems({
  api,
  items,
  onError,
}: {
  api: Api;
  items: GlobalQueueItemView[];
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { shown, move } = useGlobalOrder(api, items, onError);
  const drag = useListDrag(
    shown.map((item) => item.id),
    move,
  );
  if (shown.length === 0) {
    return (
      <Empty icon={<ListOrdered />} title={t('queue.list.empty')}>
        {t('queue.list.emptyHint')}
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col gap-2" aria-label={t('queue.list.items')}>
      {shown.map((item, index) => (
        <li
          key={item.id}
          data-id={item.id}
          draggable
          tabIndex={0}
          aria-label={`${index + 1}. ${itemLabel(item, t)}`}
          className={cn(
            'rounded-lg border bg-card p-2.5',
            item.readiness === 'blocked' && 'border-destructive',
            drag.dragging === item.id && 'opacity-50',
            item.filtered && 'opacity-60',
            drag.drop?.index === index &&
              (drag.drop.after ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
          )}
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', item.id);
            event.dataTransfer.effectAllowed = 'move';
            drag.setDragging(item.id);
          }}
          onDragOver={(event) => drag.onDragOver(event, index)}
          onDrop={(event) => drag.onDrop(event, index)}
          onDragEnd={drag.onDragEnd}
          onKeyDown={(event) => drag.onKeyDown(event, item.id, index)}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden="true" />
            <span className="w-5 text-muted-foreground tabular-nums">{index + 1}</span>
            <ProjectLabel repository={item.repository} />
            <span className="font-mono text-xs text-muted-foreground">
              {taskNumber(item.number)}
            </span>
            <PipelineBadge id={item.pipeline} name={item.pipelineName} />
            <span className="min-w-0 flex-1 truncate" title={itemLabel(item, t)}>
              {itemLabel(item, t)}
            </span>
            <TagChips tags={item.tags ?? []} />
            {item.filtered ? (
              <span className="text-xs text-muted-foreground">{t('queue.filter.filtered')}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
