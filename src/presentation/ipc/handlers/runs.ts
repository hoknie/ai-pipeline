import { currentPermissions, type RunRequests } from '../../../feature/runs/services/index.ts';

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
  status: async (params, { services, snapshots }) => {
    const now = services.now();
    if (params.runId) return snapshots.run(services.runs.states.get(params.runId), now);
    return snapshots.recentRuns(now);
  },
  finished_runs: async (params, { services, snapshots }) => {
    const now = services.now();
    const page = services.runs.states.page(params.limit, params.before);
    return { runs: page.runs.map((state) => snapshots.run(state, now)), next: page.next };
  },
  cancel: (params, context) =>
    event(context, params.runId, { kind: 'cancel', group: params.group ?? null }),
  run_skip: (params, context) =>
    event(context, params.runId, { kind: 'step_skip', step: params.step, skip: params.skip }),
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
  run_title: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () =>
      snapshots.run(await services.runs.requests.setTitle(params.runId, params.title)),
    ),
  run_tags: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () =>
      snapshots.run(await services.queue.taskTags.runTags(params)),
    ),
} satisfies Partial<HandlerTable>;
