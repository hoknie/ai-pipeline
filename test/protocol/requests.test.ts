import { describe, expect, it } from 'vitest';

import {
  parseRequest,
  requestSchema,
  type Method,
} from '../../src/presentation/ipc/contract/index.ts';

const run = { runId: 'r' };
const target = { runId: 'r', group: 'g' };
const repository = { repository: '/repo' };
const written = { ...repository, kind: 'specialist', id: 'dev', value: {}, revision: null };

/** The smallest valid params of every IPC method. */
const SAMPLES: Record<Method, unknown> = {
  ping: {},
  shutdown: {},
  shutdown_idle: {},
  subscribe: {},
  network_status: {},
  run: { ...repository, pipeline: 'feature', task: 'do it' },
  status: {},
  finished_runs: {},
  group: target,
  group_spec: target,
  group_file_diff: { ...target, path: 'a.ts' },
  group_artifacts: target,
  artifact: { ...target, id: 'a1' },
  run_patch: run,
  pipelines: repository,
  system_stages: repository,
  config: repository,
  config_catalog: repository,
  config_write: written,
  config_setting: { ...repository, path: 'web.port', value: 7341, revision: null },
  config_settings: { ...repository, values: { 'web.port': 7341 }, revision: null },
  config_preview: { ...repository, kind: 'pipeline', id: 'feature', value: {} },
  specialist_tags: {},
  shared_specialists: {},
  specialist_tags_set: { repository: null, slug: 'dev', tags: ['a'], revision: null },
  specialist_tag_rename: { repository: null, from: 'a', to: 'b' },
  specialist_tag_remove: { repository: null, tag: 'a' },
  specialists_import: { ...repository, source: '/other', slugs: ['dev'] },
  shared_pipelines: {},
  pipelines_import: { ...repository, source: '/other', ids: ['feature'] },
  config_delete: { ...repository, kind: 'pipeline', id: 'feature', revision: 'x' },
  transcript: target,
  cancel: run,
  retry: target,
  run_skip: { ...run, step: 'review', skip: true },
  apply: run,
  run_mark_delivered: run,
  answer: { ...target, answer: 'yes' },
  message: { ...target, seq: 1, text: 'hi' },
  queue: repository,
  repositories: {},
  repository_add: { path: '/repo' },
  repository_update: { path: '/repo', name: 'App' },
  repository_move: { path: '/repo', to: '/other' },
  repository_remove: { path: '/repo' },
  queue_add: { ...repository, pipeline: 'feature', task: 'do it' },
  queue_edit: { ...repository, item: 'q1' },
  queue_remove: { ...repository, item: 'q1' },
  queue_start: repository,
  queue_pause: repository,
  queue_settings: { ...repository, parallel: 2 },
  queue_return: run,
  run_pause: run,
  queue_dismiss: run,
  queue_run_now: { ...repository, item: 'q1' },
  tags: repository,
  tag_add: { ...repository, name: 'auth' },
  tag_edit: { ...repository, tag: 'auth', name: 'login' },
  tag_remove: { ...repository, tag: 'auth' },
  run_tags: { ...run, add: ['auth'] },
  run_title: { ...run, title: 'Title' },
  observers: {},
  observers_history: {},
  observers_set: { settings: {} },
  run_observer: { ...run, enabled: true },
  repair_action: { action: 'retry', token: 't', group: 'g' },
  processes: {},
  process_kill: { pid: 42 },
  web_status: {},
  web_start: {},
  web_stop: {},
  report: { token: 't', verdict: 'done', summary: 'done' },
  worker_queue_add: { token: 't', pipeline: 'feature', task: 'do it' },
  artifact_publish: { token: 't', fileName: 'a.md', content: 'text' },
  split: { token: 't', groups: [{ title: 'a', task: 'b' }] },
};

const methods = Object.keys(SAMPLES) as Method[];

describe('IPC requests', () => {
  it('has 75 methods, each in the request schema once', () => {
    const declared = requestSchema.options.map((option) => option.shape.method.value);
    expect(methods).toHaveLength(75);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...methods].sort());
  });

  it.each(methods)('parses %s', (method) => {
    const line = JSON.stringify({ id: 7, method, params: SAMPLES[method] });
    const parsed = parseRequest(line);
    expect(parsed).toMatchObject({ id: 7, request: { method } });
  });

  it('rejects an unknown method and keeps the id', () => {
    const parsed = parseRequest(JSON.stringify({ id: 3, method: 'nope', params: {} }));
    expect(parsed).toMatchObject({ id: 3 });
    expect('error' in parsed).toBe(true);
  });
});
