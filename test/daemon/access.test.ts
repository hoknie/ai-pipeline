import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IpcError, request } from '../../src/presentation/ipc/client/index.ts';
import type {
  AccessActionsView,
  AccessCheckView,
  AccessMeView,
  AuditView,
  Method,
  ParamsOf,
  QueueView,
  RepositoryView,
  RunQueued,
  RunView,
  StatsReportView,
} from '../../src/presentation/ipc/contract/index.ts';

import { copyTemplateRepo } from '../fixtures/template-repo.ts';
import { CODE_ONLY_CONFIG, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SERVER = (role = '') =>
  `server: { enabled: true, public_url: "https://aip.example.com"${role} }\n`;

async function start(options: { role?: string; access?: string; local?: boolean } = {}) {
  current = await harness();
  const directory = join(String(current.environment.XDG_CONFIG_HOME), 'aip');
  mkdirSync(directory, { recursive: true });
  if (options.local !== true) {
    writeFileSync(
      join(directory, 'settings.yaml'),
      SERVER(options.role === undefined ? '' : `, default_role: ${options.role}`),
    );
  }
  if (options.access !== undefined) writeFileSync(join(directory, 'access.yaml'), options.access);
  return current;
}

function as<M extends Method>(
  h: Harness,
  actor: string | undefined,
  method: M,
  params: ParamsOf<M>,
) {
  return request(h.socket, method, params, 30_000, actor);
}

/** A user of the given attributes; the first sign-in creates it. */
async function user(h: Harness, email: string, attributes: Record<string, string[]>) {
  const link = (await as(h, undefined, 'login_link_create', { email })) as { url: string };
  const code = link.url.split('/auth/link/')[1] as string;
  const signed = (await as(h, undefined, 'auth_link_login', { code })) as { user: { id: string } };
  await as(h, undefined, 'users_set', { email, attributes });
  return signed.user.id;
}

async function refusal(promise: Promise<unknown>): Promise<IpcError> {
  try {
    await promise;
  } catch (error) {
    return error as IpcError;
  }
  throw new Error('expected a refusal');
}

describe('the rights of a user of the server', () => {
  it('refuses a viewer what changes something, without changing anything, and writes it as denied', async () => {
    const h = await start();
    const viewer = await user(h, 'viewer@corp.com', { role: ['viewer'] });
    const error = await refusal(
      as(h, viewer, 'queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' }),
    );
    expect(error.remoteKind).toBe('forbidden');
    expect(error.remoteCode).toBe('access.denied');
    expect(error.message).toContain('queue.add');
    const queue = (await as(h, undefined, 'queue', { repository: h.repo })) as QueueView;
    expect(queue.items).toEqual([]);
    const refused = (await as(h, undefined, 'audit_list', { action: 'queue.add' })) as AuditView;
    expect(refused.events).toHaveLength(1);
    expect(refused.events[0]).toMatchObject({
      subject: viewer,
      action: 'queue.add',
      outcome: 'denied',
    });
    // reading is allowed
    await expect(as(h, viewer, 'status', {})).resolves.toEqual([]);
    await expect(as(h, viewer, 'queue', { repository: h.repo })).resolves.toBeDefined();
  });

  it('lets a developer work and refuses the shared level, as the administrator methods were', async () => {
    const h = await start();
    const developer = await user(h, 'dev@corp.com', { role: ['developer'] });
    await as(h, developer, 'queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' });
    const error = await refusal(as(h, developer, 'users_list', {}));
    expect(error.remoteCode).toBe('access.denied');
    expect(error.message).toContain('users.manage');
    await refusal(as(h, developer, 'repository_remove', { path: h.repo }));
    await refusal(as(h, developer, 'audit_list', {}));
  });

  it('refuses a user without a role every action but its own account', async () => {
    const h = await start();
    const nobody = await user(h, 'nobody@corp.com', {});
    await refusal(as(h, nobody, 'status', {}));
    await refusal(
      as(h, nobody, 'queue_add', { repository: h.repo, pipeline: 'feature', task: 'x' }),
    );
    await expect(as(h, nobody, 'whoami', {})).resolves.toBeDefined();
    await expect(as(h, nobody, 'tokens_list', {})).resolves.toBeDefined();
  });

  it('takes `server.default_role` for a user without a role', async () => {
    const h = await start({ role: 'developer' });
    const nobody = await user(h, 'nobody@corp.com', {});
    await expect(as(h, nobody, 'status', {})).resolves.toEqual([]);
    await as(h, nobody, 'queue_add', { repository: h.repo, pipeline: 'feature', task: 'work' });
    const error = await refusal(as(h, nobody, 'repository_move', { path: h.repo, to: '/tmp/x' }));
    expect(error.remoteCode).toBe('access.denied');
    expect(error.message).toContain('project.update');
    await refusal(
      as(h, nobody, 'pipelines_import', { repository: h.repo, source: '/y', ids: ['a'] }),
    );
  });

  it('applies a deny of access.yaml above the preset', async () => {
    const h = await start({
      role: 'developer',
      access: `rules:
  - id: contractors-no-apply
    effect: deny
    actions: [run.apply]
    subject: { groups: [contractors] }
`,
    });
    const contractor = await user(h, 'c@corp.com', { groups: ['contractors'] });
    const check = (await as(h, undefined, 'access_check', {
      user: 'c@corp.com',
      action: 'run.apply',
    })) as AccessCheckView;
    expect(check).toMatchObject({ decision: 'deny', reason: 'deny' });
    expect(check.matched.map((match) => match.id)).toEqual([
      'preset:developer',
      'contractors-no-apply',
    ]);
    expect(check.user.attributes.role).toEqual(['developer']);
    const me = (await as(h, contractor, 'access_me', {})) as AccessMeView;
    expect(me.actions).toContain('run.cancel');
    expect(me.actions).not.toContain('run.apply');
  });

  it('applies the pipeline and the tags of the call to run.start and queue.add', async () => {
    const h = await start({
      role: 'developer',
      access: `rules:
  - id: no-feature
    effect: deny
    actions: [queue.add, run.start]
    resource: { pipeline: [release] }
  - id: no-risky
    effect: deny
    actions: [queue.add]
    resource: { tags: [risky] }
`,
    });
    const dev = await user(h, 'dev@corp.com', {});
    const denied = await refusal(
      as(h, dev, 'queue_add', { repository: h.repo, pipeline: 'release', task: 'a' }),
    );
    expect(denied.remoteCode).toBe('access.denied');
    const run = await refusal(
      as(h, dev, 'run', { repository: h.repo, pipeline: 'release', task: 'a' }),
    );
    expect(run.remoteCode).toBe('access.denied');
    const risky = await refusal(
      as(h, dev, 'queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'a',
        tags: ['risky'],
      }),
    );
    expect(risky.remoteCode).toBe('access.denied');
    const many = await refusal(
      as(h, dev, 'queue_add_projects', {
        repositories: [h.repo, h.repo],
        pipeline: 'feature',
        task: 'a',
        tag: 'risky',
      }),
    );
    expect(many.remoteCode).toBe('access.denied');
    await expect(
      as(h, dev, 'queue_add', {
        repository: h.repo,
        pipeline: 'feature',
        task: 'a',
        postponed: true,
      }),
    ).resolves.toBeDefined();
  });

  it('checks the pipeline and the tags an edit sets, not only the ones of the task', async () => {
    const h = await start({
      role: 'developer',
      access: `rules:
  - id: no-release
    effect: deny
    actions: [queue.add, run.start]
    resource: { pipeline: [release] }
  - id: no-risky
    effect: deny
    actions: [queue.add]
    resource: { tags: [risky] }
`,
    });
    const dev = await user(h, 'dev@corp.com', {});
    await as(h, dev, 'queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'a',
      postponed: true,
    });
    const queue = (await as(h, undefined, 'queue', { repository: h.repo })) as QueueView;
    const item = (queue.items[0] as { id: string }).id;
    const toRelease = await refusal(
      as(h, dev, 'queue_edit', { repository: h.repo, item, pipeline: 'release' }),
    );
    expect(toRelease.remoteCode).toBe('access.denied');
    const toRisky = await refusal(
      as(h, dev, 'queue_edit', { repository: h.repo, item, tags: ['risky'] }),
    );
    expect(toRisky.remoteCode).toBe('access.denied');
    await expect(
      as(h, dev, 'queue_edit', { repository: h.repo, item, title: 'renamed' }),
    ).resolves.toBeDefined();
  });

  it('refuses an unknown action of access_check and names the similar ones', async () => {
    const h = await start();
    await user(h, 'a@corp.com', { role: ['admin'] });
    const error = await refusal(
      as(h, undefined, 'access_check', { user: 'a@corp.com', action: 'run.cancle' }),
    );
    expect(error.message).toContain('unknown action');
    expect(error.message).toContain('run.cancel');
  });

  it('lets `system` and `local` through without a check', async () => {
    const h = await start({ access: 'presets: false\n' });
    await expect(as(h, undefined, 'users_list', {})).resolves.toBeDefined();
    const actions = (await as(h, undefined, 'access_actions', {})) as AccessActionsView;
    expect(actions.actions.map((action) => action.name)).toContain('run.cancel');
    const me = (await as(h, undefined, 'access_me', {})) as AccessMeView;
    expect(me).toMatchObject({ actor: 'system', repositories: null });
  });

  it('reads no policies in the local mode', async () => {
    const h = await start({ local: true, access: 'rules: [broken\n' });
    await expect(as(h, undefined, 'status', {})).resolves.toEqual([]);
    await expect(
      as(h, undefined, 'queue_add', { repository: h.repo, pipeline: 'feature', task: 'x' }),
    ).resolves.toBeDefined();
    const me = (await as(h, undefined, 'access_me', {})) as AccessMeView;
    expect(me).toMatchObject({ actor: 'local', repositories: null });
  });
});

describe('what a user cannot read is not there', () => {
  it('filters the lists and answers 404 for a run of an unreadable project', async () => {
    const h = await start({
      role: 'developer',
      access: `rules:
  - id: outsiders-see-nothing
    effect: deny
    actions: ['*']
    subject: { groups: [outsiders] }
`,
    });
    const outsider = await user(h, 'bob@corp.com', { groups: ['outsiders'] });
    const insider = await user(h, 'alice@corp.com', { groups: ['dev'] });
    await as(h, undefined, 'repository_add', { path: h.repo });
    h.script({ code: [{ waitFor: h.gate('hold') }] });
    await as(h, insider, 'run', { repository: h.repo, pipeline: 'feature', task: 'work' });
    await until(
      'the run',
      async () => ((await as(h, insider, 'status', {})) as RunView[]).length === 1,
    );
    const runId = ((await as(h, insider, 'status', {})) as RunView[])[0]!.id;
    // the outsider is refused outright: no right to read anywhere
    await refusal(as(h, outsider, 'status', {}));
    expect((await as(h, outsider, 'access_me', {})) as AccessMeView).toMatchObject({
      actions: [],
      repositories: [],
    });
    const hidden = await refusal(as(h, outsider, 'status', { runId }));
    expect(hidden.message).toMatch(/unknown run/);
    await refusal(as(h, outsider, 'cancel', { runId }));
    expect((await as(h, undefined, 'status', { runId })) as RunView).toMatchObject({ id: runId });
    const repos = (await as(h, insider, 'repositories', {})) as RepositoryView[];
    expect(repos).toHaveLength(1);
    h.open('hold');
  });

  it('hides the runs of an unreadable project from a user who reads another one', async () => {
    const h = await start({
      access: `presets: false
rules:
  - id: reads-other-only
    effect: allow
    actions: [project.read, run.read, run.cancel]
    resource: { repository: [other] }
`,
    });
    const other = join(dirname(h.repo), 'other');
    copyTemplateRepo(other, CODE_ONLY_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    await as(h, undefined, 'repository_add', { path: h.repo });
    await as(h, undefined, 'repository_add', { path: other, slug: 'other' });
    const bob = await user(h, 'bob@corp.com', {});
    h.script({ code: [{ waitFor: h.gate('hold') }] });
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Work', task: 'work' }],
    });
    const runId = created.runId;
    expect(((await as(h, undefined, 'status', {})) as RunView[]).map((v) => v.id)).toContain(runId);
    expect((await as(h, bob, 'status', {})) as RunView[]).toEqual([]);
    const finished = (await as(h, bob, 'finished_runs', { limit: 15 })) as { runs?: RunView[] };
    expect(JSON.stringify(finished)).not.toContain(runId);
    for (const call of [
      () => as(h, bob, 'status', { runId }),
      () => as(h, bob, 'cancel', { runId }),
    ]) {
      const error = await refusal(call());
      expect(error.remoteCode).not.toBe('access.denied');
      expect(error.message).toMatch(/^unknown run/);
    }
    h.open('hold');
  });

  it('does not show a project of another user by its remote or link its tasks', async () => {
    const h = await start({
      access: `presets: false
rules:
  - id: reads-other-only
    effect: allow
    actions: [project.read, queue.read, queue.edit, queue.add]
    resource: { repository: [other] }
`,
    });
    const other = join(dirname(h.repo), 'other');
    copyTemplateRepo(other, CODE_ONLY_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], {
      cwd: h.repo,
    });
    await as(h, undefined, 'repository_add', { path: h.repo });
    await as(h, undefined, 'repository_add', { path: other, slug: 'other' });
    const bob = await user(h, 'bob@corp.com', {});
    const found = (await as(h, bob, 'repository_match', {
      remotes: ['git@github.com:acme/app.git'],
    })) as { project: unknown };
    expect(found.project).toBeNull();
    const foreign = (await as(h, undefined, 'queue_add', {
      repository: h.repo,
      pipeline: 'feature',
      task: 'secret',
      postponed: true,
    })) as RunQueued;
    const own = (await as(h, bob, 'queue_add', {
      repository: other,
      pipeline: 'feature',
      task: 'mine',
      postponed: true,
    })) as RunQueued;
    for (const params of [
      { source: own.item, kind: 'related', target: foreign.item },
      { source: foreign.item, kind: 'related', target: own.item },
    ]) {
      for (const method of ['task_link', 'task_unlink'] as const) {
        const error = await refusal(as(h, bob, method, params));
        expect(error.remoteCode).not.toBe('access.denied');
        expect(error.message).toMatch(/^unknown task/);
      }
    }
  });

  it('shows a user only the projects its rules allow to read', async () => {
    const h = await start({
      access: `presets: false
rules:
  - id: reads-other-only
    effect: allow
    actions: [project.read, queue.read, stats.read, config.read]
    resource: { repository: [other] }
`,
    });
    const bob = await user(h, 'bob@corp.com', {});
    const other = join(dirname(h.repo), 'other');
    copyTemplateRepo(other, CODE_ONLY_CONFIG, { 'lib.ts': 'export const value = 1;\n' });
    await as(h, undefined, 'repository_add', { path: h.repo });
    await as(h, undefined, 'repository_add', { path: other, slug: 'other' });
    const created = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Work', task: 'work' }],
    });
    await h.waitFor(created.runId, (view) => view.finished);
    await until(
      'the statistics of the project',
      async () =>
        ((await as(h, undefined, 'stats_report', {})) as StatsReportView).totals.tasks === 1,
    );
    const repos = (await as(h, bob, 'repositories', {})) as RepositoryView[];
    expect(repos.map((view) => view.path)).toEqual([other]);
    const queues = (await as(h, bob, 'queues', {})) as QueueView[];
    expect(queues.map((queue) => queue.repository)).toEqual([other]);
    await expect(as(h, bob, 'queue', { repository: 'other' })).resolves.toBeDefined();
    const error = await refusal(as(h, bob, 'queue', { repository: h.repo }));
    expect(error.remoteCode).toBe('access.denied');
    const me = (await as(h, bob, 'access_me', {})) as AccessMeView;
    expect(me.repositories).toEqual([other]);
    const report = (await as(h, bob, 'stats_report', {})) as StatsReportView;
    expect(report.repository).toBeNull();
    expect(report.totals.tasks).toBe(0);
    expect(report.projects.map((project) => project.repository)).not.toContain(h.repo);
    await refusal(as(h, bob, 'stats_report', { repository: h.repo }));
  });
});

describe('the author of a run', () => {
  it('lets only the author cancel with `author: self`', async () => {
    const h = await start({
      access: `presets: false
rules:
  - id: read
    effect: allow
    actions: [project.read, run.read, queue.read]
  - id: start
    effect: allow
    actions: [run.start]
  - id: own-runs
    effect: allow
    actions: [run.cancel]
    resource: { author: self }
`,
    });
    const alice = await user(h, 'alice@corp.com', {});
    const bob = await user(h, 'bob@corp.com', {});
    h.script({ code: [{ waitFor: h.gate('hold') }] });
    await as(h, alice, 'run', { repository: h.repo, pipeline: 'feature', task: 'work' });
    await until(
      'the run',
      async () => ((await as(h, bob, 'status', {})) as RunView[]).length === 1,
    );
    const runId = ((await as(h, bob, 'status', {})) as RunView[])[0]!.id;
    const error = await refusal(as(h, bob, 'cancel', { runId }));
    expect(error.remoteCode).toBe('access.denied');
    const me = (await as(h, bob, 'access_me', {})) as AccessMeView;
    expect(me.conditional).toEqual(['run.cancel']);
    await expect(as(h, alice, 'cancel', { runId })).resolves.toBeDefined();
    h.open('hold');
  });
});
