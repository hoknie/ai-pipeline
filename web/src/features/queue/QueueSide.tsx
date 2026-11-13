import type { Api } from '../../shared/api/api.ts';
import type { PipelinesView, QueueView } from '../../shared/api/types.ts';

import { QueueControls } from './QueueControls.tsx';
import { TakeFilter } from './TakeFilter.tsx';

/** The left column of the page: the take filter above the queue controls. */
export function QueueSide({
  api,
  queue,
  pipelines,
  parallel,
  onParallel,
  onQueue,
  onError,
  onNewTask,
}: {
  api: Api;
  queue: QueueView;
  pipelines: PipelinesView | null;
  parallel: string | null;
  onParallel: (text: string | null) => void;
  onQueue: (queue: QueueView) => void;
  onError: (message: string) => void;
  onNewTask: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TakeFilter
        api={api}
        queue={queue}
        pipelines={pipelines}
        onQueue={onQueue}
        onError={onError}
      />
      <QueueControls
        api={api}
        queue={queue}
        parallel={parallel}
        onParallel={onParallel}
        onQueue={onQueue}
        onError={onError}
        onDone={() => onParallel(null)}
        onNewTask={onNewTask}
      />
    </div>
  );
}
