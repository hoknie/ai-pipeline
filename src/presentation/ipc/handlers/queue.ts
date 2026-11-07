import type { HandlerTable, IpcContext } from './types.ts';

/** Runs `work` in the queue of the daemon, as every request of the queue does. */
function serial<T>(context: IpcContext, work: () => Promise<T>): Promise<T> {
  return context.services.runs.engine.serial(work);
}

/** The queue of tasks of a repository and the runs it holds. */
export const queueHandlers = {
  run: (params, context) =>
    serial(context, async () => {
      const queued = await context.services.queue.items.enqueue(params);
      return { ...queued, queue: context.snapshots.queue(queued.queue) };
    }),
  queue: (params, context) =>
    serial(context, async () =>
      context.snapshots.queue(await context.services.queue.control.queueOf(params.repository)),
    ),
  queue_add: (params, context) =>
    serial(context, async () => {
      const { queue, item } = await context.services.queue.items.add(params);
      return { ...context.snapshots.queue(queue), item };
    }),
  queue_edit: (params, context) =>
    serial(context, async () =>
      context.snapshots.queue(await context.services.queue.edit.edit(params)),
    ),
  queue_remove: (params, context) =>
    serial(context, async () =>
      context.snapshots.queue(await context.services.queue.items.remove(params)),
    ),
  queue_start: (params, context) =>
    serial(context, async () =>
      context.snapshots.queue(await context.services.queue.control.start(params)),
    ),
  queue_pause: (params, context) =>
    serial(context, async () =>
      context.snapshots.queue(await context.services.queue.control.pause(params)),
    ),
  queue_settings: (params, context) =>
    serial(context, async () =>
      context.snapshots.queue(await context.services.queue.control.settings(params)),
    ),
  queue_run_now: (params, context) =>
    serial(context, () => context.services.queue.control.runNow(params)),
  queue_return: async (params, context) => {
    const { queue, item } = await context.services.queue.control.returnRun(params);
    return { ...context.snapshots.queue(queue), item };
  },
  run_pause: async (params, context) => {
    const { queue, item } = await context.services.queue.control.pauseRun(params);
    return { ...context.snapshots.queue(queue), item };
  },
  queue_dismiss: async (params, context) =>
    context.snapshots.queue(await context.services.queue.control.dismiss(params)),
  worker_queue_add: async (params, context) => {
    const { queue, item } = await context.services.queue.items.workerAdd(params);
    return { ...context.snapshots.queue(queue), item };
  },
} satisfies Partial<HandlerTable>;
