import type { HandlerTable } from './types.ts';

/** The groups of a run: their logs, diffs, OpenSpec documents, artifacts and delivery. */
export const groupHandlers = {
  group: async (params, { services, snapshots }) =>
    snapshots.group(services.runs.reads.group(params.runId, params.group, params.tailLines)),
  worker_run_show: async (params, { services, snapshots }) => {
    const read = services.runs.reads.forWorker(params);
    return {
      run: snapshots.run(read.state),
      tasks: read.tasks,
      group: read.group ? snapshots.group(read.group) : null,
    };
  },
  transcript: async (params, { services }) => services.runs.reads.transcript(params),
  group_spec: (params, { services }) => services.delivery.diffs.spec(params.runId, params.group),
  group_file_diff: (params, { services }) => services.delivery.diffs.fileDiff(params),
  run_patch: (params, { services }) => services.delivery.patches.runPatch(params.runId),
  group_artifacts: async (params, { services }) => services.artifacts.list(params),
  artifact: (params, { services }) => services.artifacts.content(params),
  artifact_publish: (params, { services }) => services.artifacts.publish(params),
  apply: (params, { services }) => services.delivery.deliver.deliver(params),
  run_mark_delivered: (params, { services }) => services.delivery.deliver.markDelivered(params),
} satisfies Partial<HandlerTable>;
