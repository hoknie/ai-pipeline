import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { QueueView, RepositoryView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { bulkTargets, type BulkKind } from './bulk.ts';

/** A request per queue; a refusal of one does not cancel the others, and the notice names it. */
function useBulk(
  api: Api,
  registry: readonly RepositoryView[],
  queues: ReadonlyMap<string, QueueView>,
  onQueue: (queue: QueueView) => void,
  onError: (message: string) => void,
) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const labels = new Map(registry.map((entry) => [entry.path, entry.label]));
  const targets = (kind: BulkKind) => bulkTargets(queues.values(), registry, kind);
  const run = async (kind: BulkKind) => {
    const chosen = targets(kind);
    setBusy(true);
    const results = await Promise.allSettled(
      chosen.map((queue) => {
        const bound = api.forRepository(queue.repository);
        return kind === 'start' ? bound.queueStart() : bound.queuePause();
      }),
    );
    setBusy(false);
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') onQueue(result.value);
      else {
        const repository = chosen[index]!.repository;
        failures.push(
          t('queue.all.failed', {
            project: labels.get(repository) ?? repository,
            error: (result.reason as Error).message,
          }),
        );
      }
    });
    if (failures.length > 0) onError(failures.join('\n'));
    else notifySuccess(t(kind === 'start' ? 'queue.all.startedAll' : 'queue.all.pausedAll'));
  };
  return { busy, run, can: (kind: BulkKind) => targets(kind).length > 0 };
}

/** «New task», «Start all» and «Pause all»: the common buttons over the queues. */
export function BulkButtons({
  api,
  registry,
  queues,
  onQueue,
  onError,
  onNewTask,
}: {
  api: Api;
  registry: readonly RepositoryView[];
  queues: ReadonlyMap<string, QueueView>;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulk(api, registry, queues, onQueue, onError);
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={onNewTask}>
        <Plus className="size-4" aria-hidden="true" />
        {t('queue.newTask')}
      </Button>
      <Button
        variant="secondary"
        disabled={bulk.busy || !bulk.can('start')}
        onClick={() => void bulk.run('start')}
      >
        {t('queue.all.startAll')}
      </Button>
      <Button
        variant="outline"
        disabled={bulk.busy || !bulk.can('pause')}
        onClick={() => void bulk.run('pause')}
      >
        {t('queue.all.pauseAll')}
      </Button>
    </div>
  );
}
