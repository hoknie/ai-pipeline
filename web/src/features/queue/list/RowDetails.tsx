import { useTranslation } from 'react-i18next';
import { useState } from 'react';

import { formatRoute } from '../../../shared/lib/nav/route.ts';
import type { QueueItemView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { QueueForm, type QueueDraft } from '../QueueForm.tsx';
import { LinkChips, linkTargets } from '../../runs/index.ts';
import type { ItemScope } from './itemScope.ts';
import { itemLabel } from './itemText.ts';
import { useQueueLinks } from './links.tsx';
import type { useQueueActions } from './useQueueActions.ts';

function EditForm({
  scope,
  item,
  editing,
  actions,
  onDraft,
}: {
  scope: ItemScope;
  item: QueueItemView;
  editing: QueueDraft;
  actions: ReturnType<typeof useQueueActions>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
}) {
  const { t } = useTranslation();
  const { others } = useQueueLinks();
  const [original] = useState(() => ({ ...item, links: item.links.map((link) => ({ ...link })) }));
  const queue = scope.queueOf(item);
  return (
    <QueueForm
      idPrefix={`edit-${item.id}`}
      draft={editing}
      pipelines={scope.pipelinesOf(item)}
      repository={queue.repository}
      api={scope.apiOf(item)}
      autoDeliverDefault={queue.autoDeliver}
      deliveryModeDefault={queue.deliveryMode}
      linkChoices={(kind) =>
        linkTargets(
          kind,
          queue,
          scope.runs,
          (other) => itemLabel(other, t),
          original,
          others.filter((other) => other.repository !== queue.repository),
        )
      }
      locked={item.run !== null}
      returnedRun={item.run}
      submitLabel={t('queue.list.save')}
      onDraft={(draft) => onDraft(`edit:${item.id}`, draft)}
      onCancel={() => onDraft(`edit:${item.id}`, null)}
      onSubmit={(fields) => actions.edit(item, fields)}
    />
  );
}

/** Under a row: the predecessors, a start error, the started run and the edit form. */
export function RowDetails({
  scope,
  item,
  editing,
  actions,
  onDraft,
}: {
  scope: ItemScope;
  item: QueueItemView;
  editing: QueueDraft | undefined;
  actions: ReturnType<typeof useQueueActions>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
}) {
  const { t } = useTranslation();
  const { started } = actions;
  const { openProject } = useQueueLinks();
  const queue = scope.queueOf(item);
  return (
    <>
      {item.links.length > 0 || item.linkedBy.length > 0 ? (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[3.25rem] text-xs"
          data-dependencies=""
        >
          <LinkChips
            links={item.links}
            linkedBy={item.linkedBy}
            repository={queue.repository}
            onProject={openProject}
          />
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
      {editing ? <EditForm {...{ scope, item, editing, actions, onDraft }} /> : null}
    </>
  );
}
