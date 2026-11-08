/** Names shared by the worker server and the runtime permission adapters. */
export const WORKER_TOOLS = {
  report: 'swarm_report',
  artifact: 'swarm_artifact',
  split: 'swarm_split',
  queue: 'swarm_queue_add',
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
    ...(options.split ? [WORKER_TOOLS.split] : []),
    ...(options.queue ? [WORKER_TOOLS.queue] : []),
    ...(options.repair ? [WORKER_TOOLS.answer, WORKER_TOOLS.retry, WORKER_TOOLS.cancel] : []),
  ];
}
