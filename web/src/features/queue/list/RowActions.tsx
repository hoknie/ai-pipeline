import { CirclePause, Eye, Play, Undo2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import type { QueueItemView, QueueView } from '../../../shared/api/types.ts';
import { draftOf, type QueueDraft } from '../QueueForm.tsx';
import { runNowTip } from './itemText.ts';
import { RowAction } from './RowParts.tsx';
import type { useQueueActions } from './useQueueActions.ts';

/** The buttons of a row: edit, postpone, run now and remove. */
export function RowActions({
  item,
  queue,
  editing,
  postponed,
  actions,
  onDraft,
}: {
  item: QueueItemView;
  queue: QueueView;
  editing: QueueDraft | undefined;
  postponed: boolean;
  actions: ReturnType<typeof useQueueActions>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <span className="ml-auto flex shrink-0 gap-1" data-actions="">
      <RowAction
        label={editing ? t('queue.list.cancel') : t('queue.list.edit')}
        onClick={() => onDraft(`edit:${item.id}`, editing ? null : draftOf(item))}
      >
        {editing ? <Undo2 /> : <Eye />}
      </RowAction>
      <RowAction
        label={t('queue.list.postpone')}
        hint={t('queue.list.activeHint')}
        pressed={postponed}
        className={cn('text-status-run hover:text-status-run', postponed && 'bg-status-run-bg')}
        onClick={() => void actions.setPostponed(item, !postponed)}
      >
        <CirclePause />
      </RowAction>
      <RowAction
        label={item.hold === null ? t('queue.list.runNow') : t('queue.list.continue')}
        hint={runNowTip(queue, item, t)}
        className="text-status-ok hover:text-status-ok"
        onClick={() => void actions.runNow(item)}
      >
        <Play />
      </RowAction>
      <RowAction
        label={t('queue.list.remove')}
        className="text-status-err hover:text-status-err"
        onClick={() => void actions.remove(item)}
      >
        <X />
      </RowAction>
    </span>
  );
}
