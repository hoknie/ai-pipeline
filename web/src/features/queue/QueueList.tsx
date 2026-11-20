import { ListOrdered } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type {
  PipelinesView,
  QueueItemView as QueueItem,
  QueueView,
  RunView,
} from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Empty } from '../../shared/ui/feedback/empty.tsx';
import type { QueueDraft } from './QueueForm.tsx';
import { projectScope, type ItemScope } from './list/itemScope.ts';
import { QueueRow } from './list/QueueRow.tsx';
import { useQueueActions } from './list/useQueueActions.ts';
import { useQueueDrag } from './list/useQueueDrag.ts';
import { useQueueOrder } from './list/useQueueOrder.ts';

function Notice({ message, onClose }: { message: string | null; onClose: () => void }) {
  return message ? (
    <Alert variant="destructive" onDismiss={onClose}>
      {message}
    </Alert>
  ) : null;
}

export function QueueList({
  api,
  queue,
  runs = [],
  pipelines,
  now,
  drafts,
  onDraft,
  onQueue,
  highlight = null,
  onHighlight = () => undefined,
  scope,
  visible,
}: {
  api: Api;
  queue: QueueView;
  /** All runs of the panel: the parent choices come from them. */
  runs?: RunView[];
  pipelines: PipelinesView | null;
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  /** Ids to mark as linked to the item under the pointer or the focus; null for none. */
  highlight?: Set<string> | null;
  /** The item under the pointer or the focus, null when there is none. */
  onHighlight?: (id: string | null) => void;
  /** What a task is handled through; without it every task belongs to `queue`'s project. */
  scope?: ItemScope;
  /** Hides the tasks that do not pass (the author filter); the others keep their order. */
  visible?: (item: QueueItem) => boolean;
}) {
  const { t } = useTranslation();
  const own = useMemo(
    () => projectScope(api, queue, pipelines, runs),
    [api, queue, pipelines, runs],
  );
  const itemScope = scope ?? own;
  const [message, setMessage] = useState<string | null>(null);
  const refresh = async () => {
    try {
      onQueue(await api.queue());
    } catch {
      // the next event brings the queue
    }
  };
  const notice = { message, setMessage, refresh };
  const { shown, move } = useQueueOrder(itemScope, queue, onQueue, notice, visible);
  const actions = useQueueActions(itemScope, onQueue, onDraft, notice);
  const drag = useQueueDrag(shown, move);
  const alert = <Notice message={message} onClose={() => setMessage(null)} />;

  if (shown.length === 0) {
    return (
      <>
        <Empty icon={<ListOrdered />} title={t('queue.list.empty')}>
          {t('queue.list.emptyHint')}
        </Empty>
        {alert}
      </>
    );
  }
  return (
    <>
      {alert}
      <ol className="flex flex-col gap-2" aria-label={t('queue.list.items')}>
        {shown.map((item, index) => (
          <QueueRow
            key={item.id}
            scope={itemScope}
            queue={queue}
            item={item}
            index={index}
            now={now}
            editing={drafts[`edit:${item.id}`]}
            highlighted={highlight?.has(item.id) === true}
            onHighlight={onHighlight}
            drag={drag}
            actions={actions}
            onDraft={onDraft}
          />
        ))}
      </ol>
    </>
  );
}
