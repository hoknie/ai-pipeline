import {
  currentPermissions,
  variantConfig,
  type RunRequests,
} from '../../../feature/runs/services/index.ts';

import { rejected } from '../../../platform/errors/index.ts';
import { visible } from './access/visible.ts';
import { authorParam } from './access/author.ts';
import type { HandlerTable, IpcContext } from './types.ts';

/** Applies an event to the run and answers with its view. */
async function event(
  context: IpcContext,
  runId: string,
  build: Parameters<RunRequests['event']>[1],
): Promise<unknown> {
  return context.snapshots.run(await context.services.runs.requests.event(runId, build));
}

/** The runs: their status and what a person or a specialist does with them. */
export const runHandlers = {
  status: async (params, context) => {
    const { services, snapshots } = context;
    const now = services.now();
    if (params.runId) return snapshots.run(services.runs.states.get(params.runId), now);
    const author = authorParam(context, params.author);
    const runs = visible(context, snapshots.recentRuns(now), (run) => run.repository);
    return author === undefined ? runs : runs.filter((run) => run.author?.id === author);
  },
  finished_runs: async (params, context) => {
    const { services, snapshots } = context;
    const now = services.now();
    const author = authorParam(context, params.author);
    const page = services.runs.states.page(params.limit, params.before, params.repository, author);
    const runs = visible(context, page.runs, (state) => state.run.repository);
    return { runs: runs.map((state) => snapshots.run(state, now)), next: page.next };
  },
  cancel: (params, context) =>
    event(context, params.runId, { kind: 'cancel', group: params.group ?? null }),
  run_skip: (params, context) =>
    event(context, params.runId, { kind: 'step_skip', step: params.step, skip: params.skip }),
  run_variant: (params, context) =>
    event(context, params.runId, (state) => ({
      kind: 'variant_set',
      variant: params.variant,
      config: variantConfig(context.services.config, state, params.variant),
    })),
  run_provider: async (params, { services, snapshots }) =>
    snapshots.run(await services.runs.requests.setProvider(params.runId, params.provider)),
  run_probe: (params, { services }) =>
    services.runs.engine.serial(() => services.runs.requests.probe(params.runId, params.harness)),
  run_observer: (params, context) =>
    event(context, params.runId, { kind: 'repair_allowed', allowed: params.enabled }),
  answer: (params, context) =>
    event(context, params.runId, (state) => ({
      kind: 'answer',
      group: params.group,
      answer: params.answer,
      permissions: currentPermissions(context.services.config, state),
    })),
  message: (params, context) =>
    event(context, params.runId, {
      kind: 'message',
      group: params.group,
      seq: params.seq,
      text: params.text,
    }),
  report: (params, { services }) =>
    services.runs.requests.workerEvent(params.token, (key) => ({
      kind: 'report',
      group: key.group,
      seq: key.seq,
      report: {
        verdict: params.verdict,
        summary: params.summary,
        feedback: params.feedback ?? null,
        questions: params.questions ?? null,
        ...(params.human_only === true ? { humanOnly: true } : {}),
        ...(params.review ? { review: params.review } : {}),
        ...(params.implementation ? { implementation: params.implementation } : {}),
        ...(params.strategy ? { strategy: params.strategy } : {}),
      },
    })),
  split: (params, { services }) =>
    services.runs.requests.workerEvent(params.token, (key) => ({
      kind: 'split_proposed',
      seq: key.seq,
      groups: params.groups,
    })),
  retry: async (params, { services, snapshots }) =>
    snapshots.run(await services.queue.control.retry(params)),
  run_clean: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () => {
      const state = services.runs.states.get(params.runId);
      if (snapshots.run(state).queueItem !== null) {
        throw rejected('run is in the queue; remove its task to clean it up');
      }
      const removed = await services.runs.cleanup.clean(state, { all: params.all ?? false });
      return { run: snapshots.run(state), removed };
    }),
  run_title: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () =>
      snapshots.run(await services.runs.requests.setTitle(params.runId, params.title)),
    ),
  run_auto_deliver_cancel: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () =>
      snapshots.run(await services.runs.requests.cancelAutoDelivery(params.runId)),
    ),
  run_tags: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () =>
      snapshots.run(await services.queue.taskTags.runTags(params)),
    ),
} satisfies Partial<HandlerTable>;
