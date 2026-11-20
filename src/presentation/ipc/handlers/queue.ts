import { authorOf, createdBySystemOf } from '../../../feature/identity/types/index.ts';
import { directoryName } from '../../../feature/repos/types/index.ts';
import { visible } from './access/visible.ts';
import type { HandlerTable, IpcContext } from './types.ts';

/** Runs `work` in the queue of the daemon, as every request of the queue does. */
function serial<T>(context: IpcContext, work: () => Promise<T>): Promise<T> {
  return context.services.runs.engine.serial(async () => {
    // The mode may have been changed in the settings file by hand since the last look.
    context.services.queue.scope.sync();
    return work();
  });
}

/** The answer of a queue request; the global queue keeps only the projects the actor reads. */
function queueAnswer(
  context: IpcContext,
  queue: Parameters<IpcContext['snapshots']['queueAnswer']>[0],
) {
  const answer = context.snapshots.queueAnswer(queue);
  if (answer.scope !== 'global') return answer;
  const keep = <T extends { repository: string }>(list: T[]): T[] =>
    visible(context, list, (entry) => entry.repository);
  return {
    ...answer,
    items: keep(answer.items),
    runs: keep(answer.runs),
    skipped: keep(answer.skipped),
  };
}

/** The links of a task; an item that became a run shares them with its run. */
function viewsOfTask(context: IpcContext, id: string) {
  const { queue } = context.services;
  const run = queue.store.findItem(id)?.item.run;
  return queue.links.index.viewsOf(...(run ? [id, run] : [id]));
}

/** The queue of tasks of a repository and the runs it holds. */
export const queueHandlers = {
  run: (params, context) =>
    serial(context, async () => {
      const queued = await context.services.queue.items.enqueue({
        ...params,
        author: authorOf(context.actor),
        createdBySystem: createdBySystemOf(context.actor),
      });
      return { ...queued, queue: queueAnswer(context, queued.queue) };
    }),
  queue: (params, context) =>
    serial(context, async () =>
      queueAnswer(context, await context.services.queue.control.queueOf(params.repository)),
    ),
  queues: (_params, context) =>
    serial(context, async () => {
      const { registry, queue } = context.services;
      const labelled = registry
        .entries()
        .filter((entry) => entry.enabled)
        .map((entry) => ({
          path: entry.path,
          label: (entry.name ?? directoryName(entry.path)).toLowerCase(),
        }));
      const readable = visible(context, labelled, (entry) => entry.path);
      readable.sort(
        (left, right) =>
          (left.label < right.label ? -1 : left.label > right.label ? 1 : 0) ||
          (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      );
      return readable.map((entry) => context.snapshots.queue(queue.store.of(entry.path)));
    }),
  queue_add: (params, context) =>
    serial(context, async () => {
      const { queue, item } = await context.services.queue.items.add({
        ...params,
        author: authorOf(context.actor),
        createdBySystem: createdBySystemOf(context.actor),
      });
      return { ...queueAnswer(context, queue), item };
    }),
  queue_add_projects: (params, context) =>
    serial(context, () => {
      // The schema refused groups and attachments; they are left out of the typed request.
      const { groups: _groups, attachments: _attachments, ...request } = params;
      return context.services.queue.projects.add({
        ...request,
        author: authorOf(context.actor),
        createdBySystem: createdBySystemOf(context.actor),
      });
    }),
  queue_edit: (params, context) =>
    serial(context, async () =>
      queueAnswer(context, await context.services.queue.edit.edit(params)),
    ),
  queue_remove: (params, context) =>
    serial(context, async () =>
      queueAnswer(context, await context.services.queue.items.remove(params)),
    ),
  queue_start: (params, context) =>
    serial(context, async () =>
      queueAnswer(context, await context.services.queue.control.start(params)),
    ),
  queue_pause: (params, context) =>
    serial(context, async () =>
      queueAnswer(context, await context.services.queue.control.pause(params)),
    ),
  queue_settings: (params, context) =>
    serial(context, async () =>
      queueAnswer(context, await context.services.queue.control.settings(params)),
    ),
  queue_run_now: (params, context) =>
    serial(context, () => context.services.queue.control.runNow(params)),
  queue_return: async (params, context) => {
    const { queue, item } = await context.services.queue.control.returnRun(params);
    return { ...queueAnswer(context, queue), item };
  },
  run_pause: async (params, context) => {
    const { queue, item } = await context.services.queue.control.pauseRun(params);
    return { ...queueAnswer(context, queue), item };
  },
  queue_dismiss: async (params, context) =>
    queueAnswer(context, await context.services.queue.control.dismiss(params)),
  worker_queue_add: async (params, context) => {
    const { queue, item } = await context.services.queue.items.workerAdd(params);
    return { ...queueAnswer(context, queue), item };
  },
  task_link: (params, context) =>
    serial(context, async () => {
      const source = await context.services.queue.links.link(params);
      return { source, ...viewsOfTask(context, source) };
    }),
  task_unlink: (params, context) =>
    serial(context, async () => {
      const source = await context.services.queue.links.unlink(params);
      return { source, ...viewsOfTask(context, source) };
    }),
} satisfies Partial<HandlerTable>;
