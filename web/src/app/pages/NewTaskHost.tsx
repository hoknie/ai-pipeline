import { Suspense } from 'react';

import type { Api } from '../../shared/api/api.ts';
import type { QueueView, RunView } from '../../shared/api/types.ts';
import type { QueueDraft } from '../../features/queue/index.ts';
import { NewTaskDialog } from './pages.tsx';

/** The dialog of a new task: loaded on the first opening, then kept mounted. */
export function NewTaskHost(props: {
  api: Api;
  pageKey: string;
  selected: string;
  repositories: string[];
  waiting: React.ComponentProps<typeof NewTaskDialog>['waiting'];
  queues: ReadonlyMap<string, QueueView>;
  runs: RunView[];
  preset: { repository: string; parent: string | null } | null;
  onPresetApplied: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onExpand: (repository: string) => void;
}) {
  const { pageKey, ...rest } = props;
  return (
    <Suspense fallback={null}>
      <NewTaskDialog key={pageKey} {...rest} />
    </Suspense>
  );
}
