import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import type { QueueView } from '../../shared/api/types.ts';

import { Button } from '../../shared/ui/forms/button.tsx';
import { RunCard } from './cards/RunCard.tsx';
import { SkippedRuns } from './cards/SkippedRuns.tsx';

/** Pausing a run of the queue, one at a time. */
function usePause(
  queue: QueueView,
  api: Api,
  onQueue: (queue: QueueView) => void,
  onError: (message: string) => void,
) {
  const { t } = useTranslation();
  const [pausing, setPausing] = useState<string | null>(null);
  const pause = async (run: string) => {
    setPausing(run);
    try {
      onQueue(await api.pauseRun(run, queue.repository));
      notifySuccess(t('queue.runPaused'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPausing(null);
    }
  };
  return { pausing, pause };
}

export function QueueRuns({
  queue,
  now,
  api,
  onQueue,
  onError,
  highlight = null,
}: {
  queue: QueueView;
  now: number;
  api: Api;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Ids linked to the item under the pointer or the focus. */
  highlight?: Set<string> | null;
}) {
  const { t } = useTranslation();
  const running = queue.status === 'running';
  const { pausing, pause } = usePause(queue, api, onQueue, onError);
  const skipped =
    queue.skipped.length > 0 ? (
      <SkippedRuns queue={queue} now={now} api={api} onQueue={onQueue} onError={onError} />
    ) : null;
  if (queue.runs.length === 0 && !running) return skipped;
  const free = running ? Math.max(0, queue.parallel - queue.runs.length) : 0;
  return (
    <>
      <section aria-label={t('queue.runningLabel')}>
        <h3 className="mb-2 font-semibold">
          {t('queue.running')} ·{' '}
          {t('queue.runsPlaces', { taken: queue.runs.length, count: queue.parallel })}
        </h3>
        {queue.runs.length > queue.parallel ? (
          <p className="mb-2 text-sm text-muted-foreground">{t('queue.runsOverflow')}</p>
        ) : null}
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {queue.runs.map((run) => (
            <li key={run.id} className="min-w-0">
              <RunCard
                run={run}
                now={now}
                linked={highlight?.has(run.id) === true}
                action={
                  run.delivering || run.state === 'finished' || run.state === 'cancelled' ? null : (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={pausing === run.id}
                      disabled={pausing !== null}
                      onClick={() => void pause(run.id)}
                    >
                      {t('queue.pauseRun')}
                    </Button>
                  )
                }
              />
            </li>
          ))}
          {Array.from({ length: free }, (_, index) => (
            <li
              key={`free-${index}`}
              className="flex items-center justify-center rounded-xl border border-dashed p-3 text-sm text-muted-foreground"
            >
              {t('queue.freeSlot')}
            </li>
          ))}
        </ul>
      </section>
      {skipped}
    </>
  );
}
