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
  attachment: { ...run, id: 'a1' },
  run_patch: run,
  pipelines: repository,
  system_stages: repository,
  config: repository,
  config_catalog: repository,
  config_models: { ...repository, refresh: true },
  config_providers: repository,
  provider_models: { ...repository, provider: 'zai', refresh: true },
  config_write: written,
  config_setting: { ...repository, path: 'web.port', value: 7341, revision: null },
  config_settings: { ...repository, values: { 'web.port': 7341 }, revision: null },
  config_mcp_server: {
    ...repository,
    name: 'graph',
    value: { command: '/bin/graph', args: [], env: { TOKEN: null }, allSpecialists: false },
    revision: null,
  },
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
  run_variant: { ...run, variant: 'strong' },
  run_provider: { ...run, provider: 'openai' },
  apply: run,
  run_mark_delivered: run,
  answer: { ...target, answer: 'yes' },
  message: { ...target, seq: 1, text: 'hi' },
  queue: repository,
  queues: {},
  repositories: {},
  repository_add: { path: '/repo' },
  repository_update: { path: '/repo', name: 'App' },
  repository_move: { path: '/repo', to: '/other' },
  repository_remove: { path: '/repo' },
  queue_add: { ...repository, pipeline: 'feature', task: 'do it' },
  queue_add_projects: { repositories: ['/a', '/b'], pipeline: 'feature', task: 'do it' },
  queue_edit: { ...repository, item: 'q1' },
  task_link: { source: 'r2', kind: 'related', target: 'r1' },
  task_unlink: { source: 'r2', kind: 'related', target: 'r1' },
  queue_remove: { ...repository, item: 'q1' },
  queue_start: repository,
  queue_pause: repository,
  queue_settings: { ...repository, parallel: 2 },
  queue_return: run,
  run_pause: run,
  queue_dismiss: run,
  queue_run_now: { ...repository, item: 'q1' },
  integration_types: {},
  integration_list: {},
  integration_add: { kind: 'example', name: 'main', global: true },
  integration_remove: { id: 'c1' },
  integration_enable: { id: 'c1' },
  integration_disable: { id: 'c1' },
  integration_secret_set: { id: 'c1', slot: 'token', value: 'v' },
  integration_secret_remove: { id: 'c1', slot: 'token' },
  tags: repository,
  tag_add: { ...repository, name: 'auth' },
  tag_edit: { ...repository, tag: 'auth', name: 'login' },
  tag_remove: { ...repository, tag: 'auth' },
  run_tags: { ...run, add: ['auth'] },
  run_title: { ...run, title: 'Title' },
  run_auto_deliver_cancel: run,
  observers: {},
  observers_history: {},
  stats_report: {},
  stats_clear: { repository: '/work/app' },
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
  worker_run_show: { token: 't', run: '#1' },
  repository_match: { remotes: ['git@github.com:a/b.git'] },
  auth_resolve: { session: 's' },
  auth_link_login: { code: 'c' },
  auth_logout: { session: 's' },
  login_link_create: { email: 'a@example.com' },
  whoami: {},
  users_list: {},
  users_set: { email: 'a@example.com', attributes: { role: ['admin'] } },
  users_disable: { email: 'a@example.com' },
  users_enable: { email: 'a@example.com' },
  tokens_list: {},
  tokens_create: { name: 'laptop' },
  tokens_revoke: { token: 'laptop' },
  cli_login_begin: { challenge: 'c', machine: 'm' },
  cli_login_approve: { challenge: 'c', machine: 'm' },
  cli_login_exchange: { code: 'c', verifier: 'v' },
};

const methods = Object.keys(SAMPLES) as Method[];

describe('links in requests', () => {
  const links = [
    { kind: 'blocked_by', target: 'r1' },
    { kind: 'related', target: 3 },
  ];
  const parse = (method: string, params: unknown) =>
    parseRequest(JSON.stringify({ id: 1, method, params }));

  it('accepts links in queue_add, run and queue_edit', () => {
    for (const [method, params] of [
      ['queue_add', SAMPLES.queue_add],
      ['run', SAMPLES.run],
      ['queue_edit', SAMPLES.queue_edit],
    ] as const) {
      const parsed = parse(method, { ...(params as object), links });
      expect(parsed).toMatchObject({ request: { method } });
      expect('error' in parsed).toBe(false);
    }
  });

  it('parses task_unlink and refuses a link without a kind', () => {
    expect(parse('task_unlink', SAMPLES.task_unlink)).toMatchObject({
      request: { method: 'task_unlink' },
    });
    const bad = parse('queue_add', { ...(SAMPLES.queue_add as object), links: [{ target: 'r1' }] });
    expect('error' in bad).toBe(true);
  });
});

describe('provider requests of the shared level', () => {
  const parse = (method: string, params: unknown) =>
    parseRequest(JSON.stringify({ id: 1, method, params }));

  it('accepts config_providers and provider_models with and without level', () => {
    for (const level of [undefined, 'global']) {
      for (const method of ['config_providers', 'provider_models'] as const) {
        const parsed = parse(method, { ...(SAMPLES[method] as object), level });
        expect(parsed).toMatchObject({ request: { method } });
      }
    }
  });

  it('refuses a level other than global', () => {
    const bad = parse('config_providers', { repository: '/work/app', level: 'project' });
    expect('error' in bad).toBe(true);
  });
});

describe('IPC requests', () => {
  it('has 114 methods, each in the request schema once', () => {
    const declared = requestSchema.options.map((option) => option.shape.method.value);
    expect(methods).toHaveLength(114);
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

describe('queue pools in config_settings', () => {
  const parse = (values: unknown) =>
    parseRequest(
      JSON.stringify({
        id: 1,
        method: 'config_settings',
        params: { ...repository, values, revision: null },
      }),
    );
  const pools = { claude: { max: 2, members: ['claude'] } };

  it('accepts an object in queue.pools and a number in queue.default_pool.max', () => {
    const parsed = parse({ 'queue.pools': pools, 'queue.default_pool.max': 1 });
    expect('error' in parsed).toBe(false);
  });

  it('accepts null in both fields', () => {
    expect('error' in parse({ 'queue.pools': null, 'queue.default_pool.max': null })).toBe(false);
  });

  it('refuses a list in queue.pools and an object in a number field', () => {
    expect('error' in parse({ 'queue.pools': ['claude'] })).toBe(true);
    expect('error' in parse({ 'queue.default_pool.max': pools })).toBe(true);
  });
});
