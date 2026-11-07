import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { PipelinesView, QueueItemView, QueueView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { QueueForm, type QueueDraft } from '../QueueForm.tsx';
import { afterOptions, type ParentChoice } from '../queueLinks.ts';
import { itemLabel } from './itemText.ts';
import { DependencyChip } from './RowParts.tsx';
import type { useQueueActions } from './useQueueActions.ts';

/** Under a row: the predecessors, a start error, the started run and the edit form. */
export function RowDetails({
  api,
  item,
  queue,
  pipelines,
  parents,
  editing,
  actions,
  onDraft,
}: {
  api: Api;
  item: QueueItemView;
  queue: QueueView;
  pipelines: PipelinesView | null;
  parents: ParentChoice[];
  editing: QueueDraft | undefined;
  actions: ReturnType<typeof useQueueActions>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
}) {
  const { t } = useTranslation();
  const { started } = actions;
  return (
    <>
      {item.after.length > 0 ? (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[3.25rem] text-xs"
          data-dependencies=""
        >
          <span className="text-muted-foreground">{t('queue.list.waitsFor')}</span>
          {item.after.map((ref) => (
            <DependencyChip key={ref.id} dependency={ref} />
          ))}
        </div>
      ) : null}
      {item.error ? (
        <Alert variant="destructive" className="mt-2">
          {t('queue.list.startFailed', { error: item.error })}
        </Alert>
      ) : null}
      {started?.item === item.id ? (
        <p className="mt-2 text-sm">
          {t('queue.list.startedRun')}{' '}
          <a
            className="text-primary underline"
            href={formatRoute({
              view: 'runs',
              run: started.runId,
              group: null,
              step: null,
              tab: null,
            })}
          >
            {t('queue.list.run', { id: started.runId })}
          </a>
        </p>
      ) : null}
      {editing ? (
        <QueueForm
          idPrefix={`edit-${item.id}`}
          draft={editing}
          pipelines={pipelines}
          repository={queue.repository}
          api={api}
          autoDeliverDefault={queue.autoDeliver}
          deliveryModeDefault={queue.deliveryMode}
          afterChoices={afterOptions(queue, (other) => itemLabel(other, t), item)}
          parentChoices={parents}
          locked={item.run !== null}
          submitLabel={t('queue.list.save')}
          onDraft={(draft) => onDraft(`edit:${item.id}`, draft)}
          onCancel={() => onDraft(`edit:${item.id}`, null)}
          onSubmit={(fields) => actions.edit(item, fields)}
        />
      ) : null}
    </>
  );
}
