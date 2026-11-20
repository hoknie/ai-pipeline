import type { Method } from '../../contract/index.ts';
import type { MethodAccess } from './method-actions.ts';
import {
  anywhere,
  editedTask,
  launch,
  link,
  project,
  projects,
  run,
  task,
  taggedRun,
} from './resource.ts';

const onRun = (action: string): MethodAccess => ({ action, target: run });
const onProject = (action: string): MethodAccess => ({ action, target: project });
const onTask = (action: string): MethodAccess => ({ action, target: task });
const worker: MethodAccess = { action: null };

/** The runs, their groups, the queue and the tags. */
export const runMethods = {
  run: { action: 'run.start', target: launch },
  status: {
    action: (params) => (params.runId === undefined ? 'project.read' : 'run.read'),
    target: (params, context) => (params.runId === undefined ? anywhere() : run(params, context)),
  },
  finished_runs: onProject('project.read'),
  run_patch: onRun('run.read'),
  cancel: onRun('run.cancel'),
  retry: onRun('run.retry'),
  run_skip: onRun('run.skip'),
  run_variant: onRun('run.configure'),
  run_provider: onRun('run.configure'),
  run_title: onRun('run.configure'),
  run_auto_deliver_cancel: onRun('run.configure'),
  run_tags: {
    action: 'run.configure',
    target: run,
    also: [{ action: 'run.configure', target: taggedRun }],
  },
  run_observer: onRun('run.configure'),
  run_pause: onRun('run.configure'),
  apply: onRun('run.apply'),
  run_mark_delivered: onRun('run.apply'),
  answer: onRun('run.answer'),
  message: onRun('run.answer'),
  group: onRun('run.read'),
  group_spec: onRun('run.read'),
  group_file_diff: onRun('run.read'),
  group_artifacts: onRun('run.read'),
  artifact: onRun('run.read'),
  attachment: onRun('run.read'),
  transcript: onRun('run.read'),
  // the calls of a worker carry its report token, not a user
  repair_action: worker,
  report: worker,
  split: worker,
  worker_run_show: worker,
  artifact_publish: worker,
  worker_queue_add: worker,
  queues: { action: 'queue.read', target: anywhere },
  queue: onProject('queue.read'),
  queue_add: { action: 'queue.add', target: launch },
  queue_add_projects: { action: 'queue.add', target: projects },
  queue_edit: {
    action: 'queue.edit',
    target: task,
    also: [
      { action: 'queue.edit', target: editedTask },
      { action: 'queue.add', target: editedTask },
    ],
  },
  queue_remove: onTask('queue.edit'),
  queue_run_now: onTask('queue.edit'),
  queue_return: onRun('queue.edit'),
  queue_dismiss: onRun('queue.edit'),
  task_link: { action: 'queue.edit', target: link },
  task_unlink: { action: 'queue.edit', target: link },
  queue_start: onProject('queue.control'),
  queue_pause: onProject('queue.control'),
  queue_settings: onProject('queue.control'),
  tags: onProject('project.read'),
  tag_add: onProject('tag.write'),
  tag_edit: onProject('tag.write'),
  tag_remove: onProject('tag.write'),
} satisfies Partial<Record<Method, MethodAccess>>;
