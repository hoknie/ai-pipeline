import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { QueueView, RepositoryView } from '../../../shared/api/types.ts';
import { queueStateLabel } from '../../../shared/lib/status.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { StatusBadge } from '../../../shared/ui/feedback/StatusBadge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { ParallelStepper, parseParallel } from '../ParallelStepper.tsx';
import { StartPause } from '../QueueControls.tsx';

/** The header of a project block: name, state, parallelism, «Start», «Pause» and the link to its page. */
export function ProjectQueueHeader({
  api,
  project,
  queue,
  onQueue,
  onError,
  onOpen,
}: {
  api: Api;
  project: Pick<RepositoryView, 'path' | 'label' | 'color'>;
  queue: QueueView;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  /** Leaves the mode and opens the queue of the project. */
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const parallelId = useId();
  const [parallel, setParallel] = useState<string | null>(null);
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <ProjectDot color={project.color} />
        {project.label}
      </h3>
      <StatusBadge
        status={queue.status === 'running' ? 'running' : 'stopped'}
        label={queueStateLabel(queue.status, t)}
      />
      <ParallelStepper
        id={parallelId}
        api={api}
        queue={queue}
        text={parallel}
        onText={setParallel}
        onQueue={onQueue}
        onError={onError}
      />
      <StartPause
        api={api}
        queue={queue}
        parsed={parseParallel(parallel ?? String(queue.parallel))}
        onQueue={onQueue}
        onError={onError}
        onDone={() => setParallel(null)}
      />
      <Button variant="link" className="ml-auto" onClick={() => onOpen(project.path)}>
        {t('queue.all.openProject')}
      </Button>
    </header>
  );
}
