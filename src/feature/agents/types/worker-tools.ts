/** Names shared by the worker server and the runtime permission adapters. */
export const WORKER_TOOLS = {
  report: 'swarm_report',
  artifact: 'swarm_artifact',
  runShow: 'swarm_run_show',
  split: 'swarm_split',
  queue: 'swarm_queue_add',
  queueEdit: 'swarm_queue_edit',
  queueRemove: 'swarm_queue_remove',
  answer: 'swarm_repair_answer',
  retry: 'swarm_repair_retry',
  cancel: 'swarm_repair_cancel',
} as const;

export function workerToolNames(options: {
  split: boolean;
  queue: boolean;
  repair: boolean;
}): string[] {
  return [
    WORKER_TOOLS.report,
    WORKER_TOOLS.artifact,
    WORKER_TOOLS.runShow,
    ...(options.split ? [WORKER_TOOLS.split] : []),
    // a specialist that may queue tasks may also change and remove the waiting tasks of its run
    ...(options.queue
      ? [WORKER_TOOLS.queue, WORKER_TOOLS.queueEdit, WORKER_TOOLS.queueRemove]
      : []),
    ...(options.repair ? [WORKER_TOOLS.answer, WORKER_TOOLS.retry, WORKER_TOOLS.cancel] : []),
  ];
}
