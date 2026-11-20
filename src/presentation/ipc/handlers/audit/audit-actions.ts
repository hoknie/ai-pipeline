import type { Method } from '../../contract/index.ts';
import { type AuditRow, pick, resource, runOf, runWith, str, touched } from './audit-helpers.ts';

/** The runs, the queue, the projects, the tags, the integrations and the daemon itself. */
export const runActions: Partial<Record<Method, AuditRow>> = {
  run: {
    action: 'run.start',
    info: (params, result) => ({
      resource: resource('run', (result as { run?: { runId?: string } } | null)?.run?.runId),
      details: pick(params, 'pipeline', 'title', 'deliveryMode', 'postponed'),
    }),
  },
  cancel: { action: 'run.cancel', info: runWith('group') },
  retry: { action: 'run.retry', info: runWith('group', 'refreshConfig') },
  run_skip: { action: 'run.skip', info: runWith('step') },
  run_variant: { action: 'run.variant', info: runWith('variant') },
  run_provider: { action: 'run.provider', info: runWith('provider') },
  apply: { action: 'run.apply', info: runWith('groups', 'mode', 'force') },
  run_mark_delivered: {
    // `aip run apply` on the machine of a developer reports the delivery with its mode
    action: (params) => (params.mode === undefined ? 'run.mark_delivered' : 'run.apply'),
    info: runWith('groups', 'mode'),
  },
  run_title: { action: 'run.title', info: runWith('title') },
  run_auto_deliver_cancel: { action: 'run.auto_deliver_cancel', info: runWith() },
  run_pause: { action: 'run.pause', info: runWith() },
  run_tags: { action: 'run.tags', info: runWith('add', 'remove') },
  run_observer: { action: 'run.observer', info: runWith('enabled') },
  answer: { action: 'run.answer', info: runWith('group', 'answer') },
  message: { action: 'run.message', info: runWith('group', 'seq', 'text') },
  queue_add: {
    action: 'queue.add',
    info: (params, result) => ({
      resource: resource('queue_item', (result as { item?: string } | null)?.item),
      details: pick(params, 'pipeline', 'title', 'postponed', 'deliveryMode'),
    }),
  },
  queue_add_projects: {
    action: 'queue.add_projects',
    info: (params) => ({
      repository: null,
      details: {
        ...pick(params, 'pipeline', 'title', 'postponed'),
        repositories: params.repositories,
      },
    }),
  },
  queue_edit: {
    action: 'queue.edit',
    info: (params) => ({
      resource: resource('queue_item', params.item),
      details: { fields: touched(params, 'repository', 'item', 'revision') },
    }),
  },
  queue_remove: {
    action: 'queue.remove',
    info: (params) => ({ resource: resource('queue_item', params.item) }),
  },
  queue_run_now: {
    action: 'queue.run_now',
    info: (params) => ({ resource: resource('queue_item', params.item) }),
  },
  queue_start: { action: 'queue.start', info: (params) => ({ details: pick(params, 'parallel') }) },
  queue_pause: { action: 'queue.pause' },
  queue_settings: {
    action: 'queue.settings',
    info: (params) => ({ details: { fields: touched(params, 'repository') } }),
  },
  queue_return: { action: 'queue.return', info: runWith() },
  queue_dismiss: { action: 'queue.dismiss', info: runWith() },
  task_link: { action: 'task.link', info: (params) => ({ details: pick(params, 'kind', 'item') }) },
  task_unlink: {
    action: 'task.unlink',
    info: (params) => ({ details: pick(params, 'kind', 'item') }),
  },
  repository_add: {
    action: 'project.add',
    info: (params) => ({ repository: str(params.path), details: pick(params, 'name', 'slug') }),
  },
  repository_update: {
    action: 'project.update',
    info: (params) => ({
      repository: str(params.path),
      details: { fields: touched(params, 'path') },
    }),
  },
  repository_move: {
    action: 'project.update',
    info: (params) => ({ repository: str(params.path), details: pick(params, 'to') }),
  },
  repository_remove: {
    action: 'project.remove',
    info: (params) => ({ repository: str(params.path) }),
  },
  tag_add: { action: 'tag.add', info: (params) => ({ details: pick(params, 'name', 'color') }) },
  tag_edit: {
    action: 'tag.edit',
    info: (params) => ({ details: pick(params, 'tag', 'name', 'color') }),
  },
  tag_remove: {
    action: 'tag.remove',
    info: (params) => ({ details: pick(params, 'tag', 'tags') }),
  },
  integration_add: {
    action: 'integration.add',
    info: (params) => ({
      details: {
        ...pick(params, 'kind', 'name', 'global'),
        params: Object.keys((params.params as object | undefined) ?? {}),
      },
    }),
  },
  integration_edit: {
    action: 'integration.edit',
    info: (p) => ({
      resource: resource('integration', p.id),
      details: {
        set: Object.keys((p.set as object | undefined) ?? {}),
        unset: (p.unset as string[] | undefined) ?? [],
      },
    }),
  },
  notify_add: {
    action: 'notify.add',
    info: (p) => ({
      resource: resource('integration', p.connection),
      details: pick(p, 'allProjects', 'events'),
    }),
  },
  notify_edit: {
    action: 'notify.edit',
    info: (p) => ({ resource: resource('notification', p.id), details: pick(p, 'events') }),
  },
  notify_enable: {
    action: 'notify.enable',
    info: (p) => ({ resource: resource('notification', p.id) }),
  },
  notify_disable: {
    action: 'notify.disable',
    info: (p) => ({ resource: resource('notification', p.id) }),
  },
  notify_remove: {
    action: 'notify.remove',
    info: (p) => ({ resource: resource('notification', p.id) }),
  },
  notify_test: {
    action: 'notify.test',
    info: (p) => ({ resource: resource('notification', p.id) }),
  },
  integration_remove: {
    action: 'integration.remove',
    info: (p) => ({ resource: resource('integration', p.id) }),
  },
  integration_enable: {
    action: 'integration.enable',
    info: (p) => ({ resource: resource('integration', p.id) }),
  },
  integration_disable: {
    action: 'integration.disable',
    info: (p) => ({ resource: resource('integration', p.id) }),
  },
  integration_secret_set: {
    action: 'integration.secret_set',
    info: (p) => ({ resource: resource('integration', p.id), details: pick(p, 'slot') }),
  },
  integration_secret_remove: {
    action: 'integration.secret_remove',
    info: (p) => ({ resource: resource('integration', p.id), details: pick(p, 'slot') }),
  },
  process_kill: {
    action: 'process.kill',
    info: (params) => ({ repository: null, resource: resource('process', params.pid) }),
  },
  shutdown: { action: 'daemon.shutdown', info: () => ({ repository: null }) },
  shutdown_idle: { action: 'daemon.shutdown', info: () => ({ repository: null }) },
  web_start: { action: 'web.start', info: () => ({ repository: null }) },
  web_stop: { action: 'web.stop', info: () => ({ repository: null }) },
  // The accounts: the catalog of rights names the action; the journal keeps its own event.
};
