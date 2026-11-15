import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { QueueView, RepositoryView, RunView } from '../../../shared/api/types.ts';
import { StopReason } from '../cards/StopReason.tsx';
import type { QueueDraft } from '../QueueForm.tsx';
import { QueueList } from '../QueueList.tsx';
import { usePipelines } from '../QueuePage.tsx';
import { ProjectQueueHeader } from './ProjectQueueHeader.tsx';
import { QueueRuns } from '../QueueRuns.tsx';
import { related } from '../list/links.tsx';

/**
 * The queue of one project in the mode «All projects»: its header with the state and the
 * controls, then the reason to stop, the running runs and the waiting tasks. `api` is bound to
 * the project, so every action goes to its queue.
 */
export function ProjectQueueBlock({
  api,
  project,
  queue,
  runs,
  now,
  drafts,
  onDraft,
  onQueue,
  onError,
  onOpen,
}: {
  api: Api;
  project: Pick<RepositoryView, 'path' | 'label' | 'color'>;
  queue: QueueView;
  runs: RunView[];
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Leaves the mode and opens the queue of the project. */
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const pipelines = usePipelines(api);
  const [highlight, setHighlight] = useState<string | null>(null);
  const chain = highlight === null ? null : related(queue, highlight);
  const linked = chain !== null && chain.size > 1 ? chain : null;
  return (
    <section
      aria-label={t('queue.all.blockLabel', { project: project.label })}
      data-project-queue={project.path}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <ProjectQueueHeader
        api={api}
        project={project}
        queue={queue}
        onQueue={onQueue}
        onError={onError}
        onOpen={onOpen}
      />
      <StopReason queue={queue} />
      <QueueRuns
        queue={queue}
        now={now}
        api={api}
        onQueue={onQueue}
        onError={onError}
        highlight={linked}
      />
      <section aria-label={t('queue.waitingLabel')}>
        <h4 className="mb-2 font-semibold">{t('queue.waiting')}</h4>
        <QueueList
          api={api}
          queue={queue}
          runs={runs}
          pipelines={pipelines}
          now={now}
          drafts={drafts}
          onDraft={onDraft}
          onQueue={onQueue}
          highlight={linked}
          onHighlight={setHighlight}
        />
      </section>
    </section>
  );
}
