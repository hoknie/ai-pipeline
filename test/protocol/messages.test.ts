import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DaemonUnavailable,
  IpcError,
  parseRequest,
  request,
  requestSchema,
  streamEventSchema,
  webStartResultSchema,
  webStatusResultSchema,
  webStopResultSchema,
} from '../../src/protocol/index.ts';

describe('requests', () => {
  it('takes an optional refreshConfig flag on a retry', () => {
    const target = { runId: 'r', group: 'g' };
    const parse = (params: object) => requestSchema.safeParse({ method: 'retry', params }).success;
    expect(parse(target)).toBe(true);
    expect(parse({ ...target, refreshConfig: true })).toBe(true);
    expect(parse({ ...target, refreshConfig: 'yes' })).toBe(false);
  });

  it('parses a valid request and survives a round trip', () => {
    const line = JSON.stringify({
      id: 7,
      method: 'answer',
      params: { runId: 'r', group: 'g', answer: 'да' },
    });
    const parsed = parseRequest(line);
    expect(parsed).toEqual({
      id: 7,
      request: { method: 'answer', params: { runId: 'r', group: 'g', answer: 'да' } },
    });
    if ('request' in parsed)
      expect(requestSchema.parse(JSON.parse(JSON.stringify(parsed.request)))).toEqual(
        parsed.request,
      );
  });

  it('rejects unknown methods, invalid JSON and bad parameters with the request id', () => {
    expect(parseRequest('{')).toEqual({ id: -1, error: 'invalid JSON' });
    expect(parseRequest(JSON.stringify({ id: 3, method: 'explode', params: {} }))).toMatchObject({
      id: 3,
    });
    expect('error' in parseRequest(JSON.stringify({ id: 3, method: 'explode', params: {} }))).toBe(
      true,
    );
    const report = parseRequest(
      JSON.stringify({
        id: 4,
        method: 'report',
        params: { token: 't', verdict: 'maybe', summary: 's' },
      }),
    );
    expect('error' in report && report.error).toContain('verdict');
  });

  it('accepts structured questions in a report and rejects too many', () => {
    const request = (questions: unknown) =>
      parseRequest(
        JSON.stringify({
          id: 5,
          method: 'report',
          params: { token: 't', verdict: 'needs_human', summary: 's', questions },
        }),
      );
    expect(request([{ text: 'q', options: ['a'], recommendation: 'a' }])).toMatchObject({
      request: {
        method: 'report',
        params: { questions: [{ text: 'q', options: ['a'], recommendation: 'a' }] },
      },
    });
    expect('error' in request(Array.from({ length: 11 }, () => ({ text: 'q' })))).toBe(true);
    expect('error' in request([{ text: '' }])).toBe(true);
  });

  it('requires exactly one of task and groups for run', () => {
    const run = (params: Record<string, unknown>) =>
      parseRequest(
        JSON.stringify({
          id: 1,
          method: 'run',
          params: { repository: '/r', workflow: 'f', ...params },
        }),
      );
    expect('request' in run({ task: 'x' })).toBe(true);
    expect('request' in run({ groups: [{ title: 'a', task: 'b' }] })).toBe(true);
    expect('error' in run({})).toBe(true);
    expect('error' in run({ task: 'x', groups: [{ title: 'a', task: 'b' }] })).toBe(true);
  });
});

describe('client', () => {
  function server(answer: (line: string) => string): string {
    const path = join(mkdtempSync(join(tmpdir(), 'aip-ipc-')), 's.sock');
    const listener = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (data: string) => socket.end(`${answer(data.trim())}\n`));
    });
    listener.listen(path);
    listener.unref();
    return path;
  }

  it('returns the result of a successful response', async () => {
    const path = server((line) =>
      JSON.stringify({ id: JSON.parse(line).id, ok: true, result: { pong: true } }),
    );
    expect(await request(path, 'ping', {})).toEqual({ pong: true });
  });

  it('raises the daemon error', async () => {
    const path = server((line) =>
      JSON.stringify({ id: JSON.parse(line).id, ok: false, error: 'unknown run' }),
    );
    await expect(request(path, 'status', { runId: 'x' })).rejects.toThrow(IpcError);
  });

  it('reports an unreachable daemon', async () => {
    await expect(request('/nonexistent/aip.sock', 'ping', {})).rejects.toThrow(DaemonUnavailable);
  });
});

describe('stream events', () => {
  it('parses snapshots and run events and rejects anything else', async () => {
    const { streamEventSchema } = await import('../../src/protocol/index.ts');
    expect(streamEventSchema.parse({ event: 'snapshot', seq: 1, runs: [{ id: 'r' }] }).event).toBe(
      'snapshot',
    );
    expect(
      streamEventSchema.parse({ event: 'run', seq: 2, run: { id: 'r', extra: 1 } }).event,
    ).toBe('run');
    expect(streamEventSchema.safeParse({ event: 'tick', seq: 3 }).success).toBe(false);
    expect(
      streamEventSchema.parse({ event: 'processes', seq: 4, processes: [{ pid: 7, name: 'sh' }] }),
    ).toMatchObject({ event: 'processes', processes: [{ pid: 7 }] });
    expect(streamEventSchema.parse({ event: 'processes', seq: 5, error: 'no ps' })).toMatchObject({
      error: 'no ps',
    });
    expect(streamEventSchema.safeParse({ event: 'processes', processes: [] }).success).toBe(false);
    expect(streamEventSchema.safeParse({ event: 'run', seq: 'x', run: { id: 'r' } }).success).toBe(
      false,
    );
    expect(parseRequest(JSON.stringify({ id: 1, method: 'subscribe' }))).toMatchObject({
      request: { method: 'subscribe' },
    });
  });
});

describe('queue requests', () => {
  const parse = (method: string, params: Record<string, unknown>) =>
    parseRequest(JSON.stringify({ id: 1, method, params }));
  const ok = (method: string, params: Record<string, unknown>) =>
    expect('request' in parse(method, params)).toBe(true);
  const bad = (method: string, params: Record<string, unknown>) =>
    expect('error' in parse(method, params)).toBe(true);

  it('accepts a task or groups', () => {
    ok('queue', { repository: '/r' });
    ok('queue_add', { repository: '/r', workflow: 'feature', task: 'x', title: 'Вход' });
    ok('queue_add', { repository: '/r', workflow: 'feature', groups: [{ title: 'a', task: 'b' }] });
    ok('queue_edit', { repository: '/r', item: 'q1', position: 2, title: null });
    ok('queue_remove', { repository: '/r', item: 'q1' });
    ok('queue_start', { repository: '/r' });
    ok('queue_dismiss', { runId: 'r1' });
    ok('queue_dismiss', { runId: 'r1', repository: '/r' });
    bad('queue_dismiss', { runId: '' });
    ok('queue_start', { repository: '/r', parallel: 20 });
    ok('queue_pause', { repository: '/r' });
    ok('queue_settings', { repository: '/r', parallel: 2 });
    ok('queue_settings', { repository: '/r', skipFailed: true });
    ok('queue_settings', { repository: '/r', autopilot: false, skipFailed: false, parallel: 1 });
    ok('queue_run_now', { repository: '/r', item: 'q1' });
  });

  it('requires at least one setting and checks their types', () => {
    bad('queue_settings', { repository: '/r' });
    bad('queue_settings', { repository: '/r', parallel: 0 });
    bad('queue_settings', { repository: '/r', parallel: 21 });
    bad('queue_settings', { repository: '/r', autopilot: 'on' });
    bad('queue_settings', { repository: '/r', skipFailed: 1 });
    const error = parse('queue_settings', { repository: '/r' });
    expect(JSON.stringify(error)).toContain(
      'pass parallel, autopilot, autopilotAnswer, skipFailed or onLimit',
    );
  });

  it('takes skip as a list of non-empty step ids', () => {
    ok('run', { repository: '/r', workflow: 'feature', task: 'x', skip: ['qa'] });
    ok('queue_add', { repository: '/r', workflow: 'feature', task: 'x', skip: ['review', 'qa'] });
    ok('queue_add', { repository: '/r', workflow: 'feature', task: 'x', after: ['q1', 'r1'] });
    ok('queue_edit', { repository: '/r', item: 'q1', after: [] });
    ok('run', { repository: '/r', workflow: 'feature', task: 'x', after: ['q1'] });
    ok('worker_queue_add', { token: 't', workflow: 'feature', task: 'x', after: ['q1'] });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', after: [''] });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', after: 'q1' });
    bad('worker_queue_add', { token: 't', workflow: 'feature', task: 'x', after: [''] });
    ok('worker_queue_add', { token: 't', workflow: 'feature', task: 'x', skip: ['qa'] });
    ok('queue_edit', { repository: '/r', item: 'q1', skip: [] });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', skip: [''] });
    bad('queue_edit', { repository: '/r', item: 'q1', skip: 'qa' });
  });

  it('takes autoDeliver as a boolean, and null only when editing', () => {
    ok('run', { repository: '/r', workflow: 'feature', task: 'x', autoDeliver: false });
    ok('queue_add', { repository: '/r', workflow: 'feature', task: 'x', autoDeliver: true });
    ok('worker_queue_add', { token: 't', workflow: 'feature', task: 'x', autoDeliver: false });
    ok('queue_edit', { repository: '/r', item: 'q1', autoDeliver: null });
    ok('queue_edit', { repository: '/r', item: 'q1', autoDeliver: false });
    bad('run', { repository: '/r', workflow: 'feature', task: 'x', autoDeliver: 'no' });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', autoDeliver: null });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', autoDeliver: 1 });
    bad('worker_queue_add', { token: 't', workflow: 'feature', task: 'x', autoDeliver: null });
    bad('queue_edit', { repository: '/r', item: 'q1', autoDeliver: 'yes' });
  });

  it('takes a delivery mode of a task, and null only when editing', () => {
    ok('run', { repository: '/r', workflow: 'feature', task: 'x', deliveryMode: 'commit' });
    ok('queue_add', { repository: '/r', workflow: 'feature', task: 'x', deliveryMode: 'branch' });
    ok('worker_queue_add', {
      token: 't',
      workflow: 'feature',
      task: 'x',
      deliveryMode: 'worktree',
    });
    ok('queue_edit', { repository: '/r', item: 'q1', deliveryMode: null });
    bad('run', { repository: '/r', workflow: 'feature', task: 'x', deliveryMode: 'patch' });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', deliveryMode: null });
    bad('queue_edit', { repository: '/r', item: 'q1', deliveryMode: true });
  });

  it('takes the text of the autopilot answer, and null to reset it', () => {
    ok('queue_settings', { repository: '/r', autopilotAnswer: 'Согласен' });
    ok('queue_settings', { repository: '/r', autopilotAnswer: null });
    bad('queue_settings', { repository: '/r', autopilotAnswer: '  ' });
    bad('queue_settings', { repository: '/r', autopilotAnswer: 'x'.repeat(2001) });
  });

  it('takes a setting of the catalog with a value of any kind', () => {
    ok('config_setting', {
      repository: '/r',
      path: 'delivery.mode',
      value: 'commit',
      revision: null,
    });
    ok('config_setting', { repository: '/r', path: 'delivery.mode', value: null, revision: 'x' });
    ok('config_setting', { repository: '/r', path: 'max', value: 4, revision: null });
    ok('config_setting', {
      repository: '/r',
      path: 'workspace.include',
      value: ['a'],
      revision: null,
    });
    ok('config_setting', {
      repository: '/r',
      path: 'runtimes.claude.env.KEY',
      value: 'v',
      revision: null,
    });
    bad('config_setting', { repository: '/r', path: 'delivery.mode', value: {}, revision: null });
  });

  it('takes a setting only from the catalog', () => {
    bad('config_setting', { repository: '/r', path: 'specialists.x', value: 'a', revision: null });
    bad('config_setting', {
      repository: '/r',
      path: 'runtimes.claude.env.1BAD',
      value: 'a',
      revision: null,
    });
  });

  it('parses config_settings and refuses an empty or unknown set', () => {
    ok('config_settings', {
      repository: '/r',
      values: { max: 4, 'delivery.auto': false },
      revision: null,
    });
    bad('config_settings', { repository: '/r', values: {}, revision: null });
    bad('config_settings', { repository: '/r', values: { nope: 1 }, revision: null });
    bad('config_settings', { repository: '/r', values: { max: 1 } });
  });

  it('rejects both a task and groups, neither, an empty task and a long title', () => {
    bad('queue_add', {
      repository: '/r',
      workflow: 'feature',
      task: 'x',
      groups: [{ title: 'a', task: 'b' }],
    });
    bad('queue_add', { repository: '/r', workflow: 'feature' });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: '   ' });
    bad('queue_add', { repository: '/r', workflow: 'feature', task: 'x', title: 'я'.repeat(61) });
    bad('queue_add', { repository: '/r', workflow: 'feature', groups: [] });
    bad('queue_edit', {
      repository: '/r',
      item: 'q1',
      task: 'x',
      groups: [{ title: 'a', task: 'b' }],
    });
    bad('queue_edit', { repository: '/r', item: 'q1', position: 0 });
  });

  it('keeps parallel within 1 to 20', () => {
    bad('queue_start', { repository: '/r', parallel: 0 });
    bad('queue_start', { repository: '/r', parallel: 21 });
    bad('queue_settings', { repository: '/r', parallel: 1.5 });
    bad('queue_settings', { repository: '/r' });
    bad('queue', {});
  });
});

describe('config requests', () => {
  const write = {
    repository: '/repo',
    kind: 'specialist',
    id: 'coder',
    value: { name: 'C' },
    revision: null,
  };

  it('accepts a write of a new specialist and a delete with a revision', () => {
    expect(requestSchema.safeParse({ method: 'config_write', params: write }).success).toBe(true);
    expect(
      requestSchema.safeParse({
        method: 'config_delete',
        params: { repository: '/repo', kind: 'specialist', id: 'coder', revision: 'abc' },
      }).success,
    ).toBe(true);
  });

  it('rejects an id that is not a slug', () => {
    for (const id of ['../settings', 'Coder', '', 'a'.repeat(40)]) {
      expect(
        requestSchema.safeParse({ method: 'config_write', params: { ...write, id } }).success,
      ).toBe(false);
    }
  });

  it('requires the revision of a delete and a value of a write', () => {
    expect(
      requestSchema.safeParse({
        method: 'config_delete',
        params: { repository: '/repo', kind: 'specialist', id: 'coder' },
      }).success,
    ).toBe(false);
    const { value: _value, ...withoutValue } = write;
    expect(requestSchema.safeParse({ method: 'config_write', params: withoutValue }).success).toBe(
      false,
    );
    expect(
      requestSchema.safeParse({ method: 'config_write', params: { ...write, revision: undefined } })
        .success,
    ).toBe(false);
  });
});

describe('workflow config requests', () => {
  it('accepts a workflow write and a preview', () => {
    const base = { repository: '/repo', kind: 'workflow', id: 'feature', value: { steps: [] } };
    expect(
      requestSchema.safeParse({ method: 'config_write', params: { ...base, revision: null } })
        .success,
    ).toBe(true);
    expect(requestSchema.safeParse({ method: 'config_preview', params: base }).success).toBe(true);
  });

  it('rejects a preview of a specialist, without a value, and with a bad id', () => {
    const base = { repository: '/repo', kind: 'workflow', id: 'feature', value: {} };
    expect(
      requestSchema.safeParse({ method: 'config_preview', params: { ...base, kind: 'specialist' } })
        .success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({ method: 'config_preview', params: { ...base, id: 'Feature_1' } })
        .success,
    ).toBe(false);
    const { value: _value, ...withoutValue } = base;
    expect(
      requestSchema.safeParse({ method: 'config_preview', params: withoutValue }).success,
    ).toBe(false);
  });
});

describe('repository registry requests', () => {
  const parse = (method: string, params?: Record<string, unknown>) =>
    parseRequest(JSON.stringify({ id: 1, method, params }));

  it('accepts the registry methods and rejects an empty path', () => {
    expect('request' in parse('repositories')).toBe(true);
    expect('request' in parse('repository_add', { path: '/r' })).toBe(true);
    expect('request' in parse('repository_remove', { path: '/r' })).toBe(true);
    expect('error' in parse('repository_add', { path: '' })).toBe(true);
    expect('error' in parse('repository_remove', {})).toBe(true);
  });

  it('parses snapshots with and without repositories and the repositories event', async () => {
    const { streamEventSchema } = await import('../../src/protocol/index.ts');
    expect(streamEventSchema.safeParse({ event: 'snapshot', seq: 1, runs: [] }).success).toBe(true);
    expect(
      streamEventSchema.safeParse({
        event: 'snapshot',
        seq: 1,
        runs: [],
        repositories: [{ path: '/r' }],
      }).success,
    ).toBe(true);
    expect(
      streamEventSchema.safeParse({ event: 'repositories', seq: 2, repositories: [{ path: '/r' }] })
        .success,
    ).toBe(true);
  });
});

describe('config_catalog request', () => {
  it('needs a repository', () => {
    expect(
      requestSchema.safeParse({ method: 'config_catalog', params: { repository: '/r' } }).success,
    ).toBe(true);
    expect(requestSchema.safeParse({ method: 'config_catalog', params: {} }).success).toBe(false);
  });
});

describe('tag requests', () => {
  const parse = (method: string, params: Record<string, unknown>) =>
    parseRequest(JSON.stringify({ id: 1, method, params }));
  const ok = (method: string, params: Record<string, unknown>) =>
    expect('request' in parse(method, params)).toBe(true);
  const bad = (method: string, params: Record<string, unknown>) =>
    expect('error' in parse(method, params)).toBe(true);

  it('accepts the catalog methods', () => {
    ok('tags', {});
    ok('tag_add', { name: 'auth' });
    ok('tag_add', { name: 'auth', color: 'blue' });
    ok('tag_edit', { tag: 'auth', name: 'login' });
    ok('tag_edit', { tag: 'auth', color: 'teal' });
    bad('tag_edit', { tag: 'auth' });
    ok('tag_remove', { tag: 'auth' });
    bad('tag_remove', {});
  });

  it('accepts run_skip only with a boolean skip', () => {
    ok('run_skip', { runId: 'r', step: 'qa', skip: true });
    bad('run_skip', { runId: 'r', step: 'qa' });
  });

  it('needs something to add or remove in run_tags', () => {
    ok('run_tags', { runId: 'r', add: ['auth'] });
    ok('run_tags', { runId: 'r', remove: ['auth'] });
    ok('run_tags', { runId: 'r', add: ['a'], remove: ['b'] });
    bad('run_tags', { runId: 'r' });
    bad('run_tags', { runId: 'r', add: [], remove: [] });
  });

  it('takes tag names in run, queue_add and queue_edit and limits them', () => {
    ok('run', { repository: '/r', workflow: 'f', task: 'x', tags: ['auth'] });
    ok('queue_add', { repository: '/r', workflow: 'f', task: 'x', tags: ['auth', 'v2'] });
    ok('queue_edit', { repository: '/r', item: 'q1', tags: [] });
    bad('queue_add', { repository: '/r', workflow: 'f', task: 'x', tags: ['x'.repeat(31)] });
    bad('queue_add', { repository: '/r', workflow: 'f', task: 'x', tags: [''] });
    bad('queue_add', {
      repository: '/r',
      workflow: 'f',
      task: 'x',
      tags: Array.from({ length: 21 }, (_, index) => `t${index}`),
    });
  });

  it('drops tags from a task added by a specialist', () => {
    const parsed = parse('worker_queue_add', { token: 't', workflow: 'f', task: 'x', tags: ['a'] });
    expect('request' in parsed && parsed.request.params).not.toHaveProperty('tags');
  });
});

describe('stream events of tags', () => {
  it('parses the tags event and a snapshot with and without the catalog', () => {
    expect(
      streamEventSchema.safeParse({ event: 'tags', seq: 1, tags: [{ id: 'a' }] }).success,
    ).toBe(true);
    const snapshot = { event: 'snapshot', seq: 1, runs: [] };
    expect(streamEventSchema.safeParse(snapshot).success).toBe(true);
    expect(streamEventSchema.safeParse({ ...snapshot, tags: [{ id: 'a' }] }).success).toBe(true);
  });
});

describe('web panel control', () => {
  it('parses web_status, web_start and web_stop', () => {
    expect(parseRequest(JSON.stringify({ id: 1, method: 'web_status' }))).toEqual({
      id: 1,
      request: { method: 'web_status', params: {} },
    });
    expect(parseRequest(JSON.stringify({ id: 2, method: 'web_stop', params: {} }))).toMatchObject({
      request: { method: 'web_stop' },
    });
    const start = parseRequest(
      JSON.stringify({
        id: 3,
        method: 'web_start',
        params: { token: 'abcdefghijklmnop1234', restart: true },
      }),
    );
    expect(start).toEqual({
      id: 3,
      request: {
        method: 'web_start',
        params: { token: 'abcdefghijklmnop1234', restart: true },
      },
    });
    expect(parseRequest(JSON.stringify({ id: 4, method: 'web_start' }))).toMatchObject({
      request: { params: {} },
    });
  });

  it('rejects a malformed token', () => {
    const parsed = parseRequest(
      JSON.stringify({ id: 5, method: 'web_start', params: { token: 'short' } }),
    );
    expect(parsed).toMatchObject({ id: 5 });
    expect('error' in parsed).toBe(true);
  });

  it('checks the answers', () => {
    const status = {
      running: true,
      host: '127.0.0.1',
      port: 7341,
      auth: 'token',
      url: 'http://127.0.0.1:7341/?token=x',
      reason: null,
      stopped: false,
    };
    expect(webStatusResultSchema.parse(status)).toEqual(status);
    expect(webStartResultSchema.parse({ state: 'restarted', status })).toMatchObject({
      state: 'restarted',
    });
    expect(webStopResultSchema.parse({ state: 'not_running' })).toEqual({ state: 'not_running' });
    expect(webStatusResultSchema.safeParse({ running: true }).success).toBe(false);
    expect(webStartResultSchema.safeParse({ state: 'started' }).success).toBe(false);
    expect(webStopResultSchema.safeParse({ state: 'gone' }).success).toBe(false);
  });
});

describe('background processes', () => {
  it('parses processes and process_kill', () => {
    expect(parseRequest(JSON.stringify({ id: 1, method: 'processes' }))).toEqual({
      id: 1,
      request: { method: 'processes', params: {} },
    });
    expect(
      parseRequest(JSON.stringify({ id: 2, method: 'process_kill', params: { pid: 4242 } })),
    ).toEqual({ id: 2, request: { method: 'process_kill', params: { pid: 4242 } } });
  });

  it.each([0, -1, '1', 1.5])('rejects the pid %j', (pid) => {
    expect(
      'error' in parseRequest(JSON.stringify({ id: 3, method: 'process_kill', params: { pid } })),
    ).toBe(true);
  });
});
