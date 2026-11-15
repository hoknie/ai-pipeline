import { useTranslation } from 'react-i18next';

import type { GlobalQueueView } from '../../../shared/api/types.ts';
import { RunCard } from '../cards/RunCard.tsx';
import { ProjectLabel } from './ProjectLabel.tsx';

/** The runs that hold a place of the global queue, and the runs it skipped, with their projects. */
export function GlobalRuns({ queue, now }: { queue: GlobalQueueView; now: number }) {
  const { t } = useTranslation();
  const lists = [
    { key: 'running', label: t('queue.running'), runs: queue.runs },
    {
      key: 'skipped',
      label: t('queue.skipped', { count: queue.skipped.length }),
      runs: queue.skipped,
    },
  ].filter((list) => list.runs.length > 0);
  return (
    <>
      {lists.map((list) => (
        <section key={list.key} aria-label={list.label}>
          <h3 className="mb-2 font-semibold">
            {list.label}
            {list.key === 'running'
              ? ` · ${t('queue.runsPlaces', { taken: list.runs.length, count: queue.parallel })}`
              : ''}
          </h3>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {list.runs.map((run) => (
              <li key={run.id} className="flex min-w-0 flex-col gap-1">
                <ProjectLabel repository={run.repository} />
                <RunCard run={run} now={now} linked={false} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
