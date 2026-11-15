import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { QueueView, RepositoryView, RunView } from '../../../shared/api/types.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import type { QueueDraft } from '../QueueForm.tsx';
import { BulkButtons } from './BulkButtons.tsx';
import { EmptyQueues } from './EmptyQueues.tsx';
import { ProjectQueueBlock } from './ProjectQueueBlock.tsx';

/** The projects of the mode in the order of their names, without regard to case, then paths. */
function byLabel(registry: readonly RepositoryView[]): RepositoryView[] {
  return registry
    .filter((entry) => entry.enabled)
    .sort((left, right) => {
      const names = left.label.toLowerCase().localeCompare(right.label.toLowerCase());
      return names !== 0 ? names : left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
}

/** Whether the queue has nothing to show: no tasks, no runs, no reason to stop, and stopped. */
function isEmpty(queue: QueueView | undefined): boolean {
  return (
    queue === undefined ||
    (queue.items.length === 0 &&
      queue.runs.length === 0 &&
      queue.skipped.length === 0 &&
      queue.stop === null &&
      queue.status === 'stopped')
  );
}

/**
 * The queue section in the mode «All projects»: the common buttons, a block per project with
 * something to show, and one line with the names of the empty queues.
 */
export default function AllQueuesPage({
  api,
  registry,
  queues,
  runs,
  now,
  drafts,
  onDraft,
  onQueue,
  onError,
  onNewTask,
  onOpenProject,
}: {
  /** Any api: each request is made through `forRepository` of its project. */
  api: Api;
  registry: readonly RepositoryView[];
  queues: ReadonlyMap<string, QueueView>;
  runs: RunView[];
  now: number;
  drafts: Record<string, QueueDraft>;
  onDraft: (key: string, draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
  /** Leaves the mode and opens the queue of the project. */
  onOpenProject: (path: string) => void;
}) {
  const { t } = useTranslation();
  const projects = byLabel(registry);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const open = async (path: string) => {
    setShown((current) => new Set(current).add(path));
    try {
      onQueue(await api.forRepository(path).queue());
    } catch (error) {
      onError((error as Error).message);
    }
  };
  if (projects.length === 0) {
    return (
      <div className="p-4">
        <Empty title={t('queue.all.nothing')} />
      </div>
    );
  }
  const blocks = projects.filter(
    (entry) => shown.has(entry.path) || !isEmpty(queues.get(entry.path)),
  );
  const empty = projects.filter((entry) => !blocks.includes(entry));
  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <BulkButtons {...{ api, registry, queues, onQueue, onError, onNewTask }} />
      {blocks.map((entry) => {
        const queue = queues.get(entry.path);
        return queue ? (
          <ProjectQueueBlock
            key={entry.path}
            api={api.forRepository(entry.path)}
            project={entry}
            queue={queue}
            runs={runs}
            now={now}
            drafts={drafts}
            onDraft={onDraft}
            onQueue={onQueue}
            onError={onError}
            onOpen={onOpenProject}
          />
        ) : null;
      })}
      <EmptyQueues projects={empty} onOpen={(path) => void open(path)} />
    </div>
  );
}
