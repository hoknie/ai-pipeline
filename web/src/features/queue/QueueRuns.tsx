import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { notifySuccess } from '../../shared/lib/browser/notify.ts';
import type { QueueRunView, QueueView } from '../../shared/api/types.ts';

import { Button } from '../../shared/ui/forms/button.tsx';
import { RunCard } from './cards/RunCard.tsx';
import { ProjectLabel } from './list/ProjectLabel.tsx';
import { SkippedRuns } from './cards/SkippedRuns.tsx';

/** Pausing a run of the queue, one at a time. */
function usePause(
  repositoryOf: (run: QueueRunView) => string,
  api: Api,
  onQueue: (queue: QueueView) => void,
  onError: (message: string) => void,
) {
  const { t } = useTranslation();
  const [pausing, setPausing] = useState<string | null>(null);
  const pause = async (run: QueueRunView) => {
    setPausing(run.id);
    try {
      onQueue(await api.pauseRun(run.id, repositoryOf(run)));
      notifySuccess(t('queue.runPaused'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPausing(null);
    }
  };
  return { pausing, pause };
}

/** The places of the queue that no run holds. */
function FreeSlots({ count }: { count: number }) {
  const { t } = useTranslation();
  return Array.from({ length: count }, (_, index) => (
    <li
      key={`free-${index}`}
      className="flex items-center justify-center rounded-xl border border-dashed p-3 text-sm text-muted-foreground"
    >
      {t('queue.freeSlot')}
    </li>
  ));
}

interface QueueRunsProps {
  queue: QueueView;
  now: number;
  api: Api;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Ids linked to the item under the pointer or the focus. */
  highlight?: Set<string> | null;
  /** The project a run belongs to; default: the project of `queue`. */
  repositoryOf?: (run: QueueRunView) => string;
  /** The path to label a run with; without it no label. */
  projectOf?: (run: QueueRunView) => string | undefined;
  /** Hides the runs that do not pass (the author filter), the skipped ones too. */
  visible?: (run: QueueRunView) => boolean;
}

export function QueueRuns({
  queue,
  now,
  api,
  onQueue,
  onError,
  highlight = null,
  repositoryOf = () => queue.repository,
  projectOf,
  visible,
}: QueueRunsProps) {
  const { t } = useTranslation();
  const running = queue.status === 'running';
  const { pausing, pause } = usePause(repositoryOf, api, onQueue, onError);
  const shown =
    visible === undefined
      ? queue
      : { ...queue, runs: queue.runs.filter(visible), skipped: queue.skipped.filter(visible) };
  const skipped =
    shown.skipped.length > 0 ? (
      <SkippedRuns
        queue={shown}
        now={now}
        api={api}
        onQueue={onQueue}
        onError={onError}
        repositoryOf={repositoryOf}
        {...(projectOf ? { projectOf } : {})}
      />
    ) : null;
  if (shown.runs.length === 0 && !running) return skipped;
  // a filtered list has no free places to show: the hidden runs hold some of them
  const free =
    running && visible === undefined ? Math.max(0, queue.parallel - queue.runs.length) : 0;
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
          {shown.runs.map((run) => (
            <li key={run.id} className="flex min-w-0 flex-col gap-1">
              {projectOf?.(run) !== undefined ? (
                <ProjectLabel repository={projectOf(run) as string} />
              ) : null}
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
                      onClick={() => void pause(run)}
                    >
                      {t('queue.pauseRun')}
                    </Button>
                  )
                }
              />
            </li>
          ))}
          <FreeSlots count={free} />
        </ul>
      </section>
      {skipped}
    </>
  );
}
