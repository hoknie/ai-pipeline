import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ApplyResult, RunCreated } from '../../src/presentation/ipc/contract/index.ts';

import { CODE_ONLY_CONFIG, git, harness, startRun, statuses, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const SPLIT_CONFIG = CODE_ONLY_CONFIG.replace(
  '    feature:\n      steps:',
  '    feature:\n      split: { specialist: coder }\n      steps:',
);

/** A run that splits a task and keeps the ignored `openspec/` paths in the workspace of the run. */
async function start(extra = ''): Promise<Harness> {
  current = await harness(
    `${SPLIT_CONFIG}  workspace: { include: [openspec/] }\n  delivery: { auto: false }\n${extra}`,
  );
  return current;
}

/** The repository ignores `openspec/`: only `workspace.include` can carry it. */
function ignoreOpenspec(h: Harness): void {
  writeFileSync(join(h.repo, '.gitignore'), 'openspec/\n');
  git(h.repo, 'add', '.gitignore');
  git(h.repo, 'commit', '-q', '-m', 'ignore openspec');
}

function splitRun(h: Harness, task: string): Promise<RunCreated> {
  return startRun(h, { repository: h.repo, pipeline: 'feature', task }) as Promise<RunCreated>;
}

function reads(
  h: Harness,
): { step: string; group: string; contents: Record<string, string | null> }[] {
  return readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          step: string;
          group: string;
          contents: Record<string, string | null>;
        },
    );
}

describe('the result of the split step', () => {
  it('commits ignored files and lets the groups see them', async () => {
    const h = await start();
    ignoreOpenspec(h);
    h.script({
      split: [
        {
          write: { 'openspec/changes/x/tasks.md': 'tasks of the change\n' },
          split: [{ title: 'Login', task: 'login' }],
        },
      ],
      code: [
        {
          read: ['openspec/changes/x/tasks.md'],
          write: { 'login.ts': 'export const on = true;\n' },
        },
      ],
    });
    const created = await splitRun(h, 'login');
    expect(created.split).toBe(true);
    const final = await h.waitFor(created.runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(reads(h).find((entry) => entry.step === 'code')?.contents).toEqual({
      'openspec/changes/x/tasks.md': 'tasks of the change\n',
    });
    const log = git(h.repo, 'log', '--format=%s', `refs/aip/${created.runId}/run`);
    expect(log).toContain('aip(_split/split): split done');
  });

  it('is delivered with the edit of a group and is not applied twice', async () => {
    const h = await start();
    ignoreOpenspec(h);
    h.script({
      split: [
        {
          write: { 'openspec/changes/x/specs.md': 'version 1\n' },
          split: [
            { title: 'Login', task: 'login' },
            { title: 'Logout', task: 'logout' },
          ],
        },
      ],
      'code@Login': [
        {
          write: {
            'openspec/changes/x/specs.md': 'version 2 by login\n',
            'login.ts': 'export const login = true;\n',
          },
        },
      ],
      'code@Logout': [{ write: { 'logout.ts': 'export const logout = true;\n' } }],
    });
    const created = await splitRun(h, 'login and logout');
    await h.waitFor(created.runId, (view) => view.finished);
    const detail = await h.group(created.runId, 'login');
    expect(readFileSync(join(detail.worktree, 'openspec/changes/x/specs.md'), 'utf8')).toBe(
      'version 2 by login\n',
    );

    const first = (await h.call('apply', {
      runId: created.runId,
      groups: ['login'],
    })) as ApplyResult;
    expect(first.groups[0]?.delivery.state).toBe('applied');
    expect(readFileSync(join(h.repo, 'openspec/changes/x/specs.md'), 'utf8')).toBe(
      'version 2 by login\n',
    );
    expect(readFileSync(join(h.repo, 'login.ts'), 'utf8')).toBe('export const login = true;\n');

    const second = (await h.call('apply', {
      runId: created.runId,
      groups: ['logout'],
    })) as ApplyResult;
    expect(second.groups[0]?.delivery.state).toBe('applied');
    expect(readFileSync(join(h.repo, 'openspec/changes/x/specs.md'), 'utf8')).toBe(
      'version 2 by login\n',
    );
    expect(readFileSync(join(h.repo, 'logout.ts'), 'utf8')).toBe('export const logout = true;\n');
  });

  it('leaves the run ref at the base commit and the delivery unchanged without changes', async () => {
    const h = await start();
    const base = git(h.repo, 'rev-parse', 'HEAD');
    h.script({
      split: [{ split: [{ title: 'Login', task: 'login' }] }],
      code: [{ write: { 'login.ts': 'export const login = true;\n' } }],
    });
    const created = await splitRun(h, 'login');
    const final = await h.waitFor(created.runId, (view) => view.finished);
    expect(statuses(final)).toEqual(['merged']);
    expect(git(h.repo, 'log', '--format=%s', `refs/aip/${created.runId}/run`)).not.toContain(
      '_split/split',
    );
    expect(git(h.repo, 'rev-parse', `refs/aip/${created.runId}/run^`)).toBe(base);

    const result = (await h.call('apply', { runId: created.runId })) as ApplyResult;
    expect(result.groups[0]?.delivery.files).toEqual(['login.ts']);
    expect(existsSync(join(h.repo, 'openspec'))).toBe(false);
  });

  it('fails the split and starts nothing when its commit cannot move the run ref', async () => {
    const h = await start(
      '  actions:\n    notes: { run: "echo notes > notes.md" }\n  stages:\n    after_split: [notes]\n',
    );
    ignoreOpenspec(h);
    h.script({
      split: [
        {
          write: { 'openspec/changes/x/tasks.md': 'tasks of the change\n' },
          split: [{ title: 'Login', task: 'login' }],
          waitFor: h.gate('split'),
        },
      ],
      code: [{ write: { 'login.ts': 'export const login = true;\n' } }],
    });
    const created = await splitRun(h, 'login');
    const before = git(h.repo, 'rev-parse', `refs/aip/${created.runId}/run`);
    // The commit lands in the tree of the run but cannot move a locked ref: the split has no result.
    const lock = join(h.repo, '.git', 'refs', 'aip', created.runId, 'run.lock');
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, '');
    h.open('split');
    const final = await h.waitFor(created.runId, (view) => view.finished);
    expect(final.groups).toEqual([]);
    expect(
      final.system.map((row) => `${row.kind}:${row.point ?? ''}:${row.action ?? ''}:${row.status}`),
    ).toEqual(['split:::failed', 'action:after_split:notes:cancelled']);
    expect(git(h.repo, 'rev-parse', `refs/aip/${created.runId}/run`)).toBe(before);
    const calls = readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8').trim().split('\n');
    expect(calls.map((line) => (JSON.parse(line) as { step: string }).step)).toEqual(['split']);
  });

  it('commits the result it already has when the run ref unlocks before the retry', async () => {
    const h = await start(
      '  actions:\n    notes: { run: "echo notes > notes.md" }\n  stages:\n    after_split: [notes]\n',
    );
    ignoreOpenspec(h);
    h.script({
      split: [
        {
          write: { 'openspec/changes/x/tasks.md': 'tasks of the change\n' },
          split: [{ title: 'Login', task: 'login' }],
          waitFor: h.gate('split'),
        },
      ],
      code: [
        {
          read: ['openspec/changes/x/tasks.md'],
          write: { 'login.ts': 'export const login = true;\n' },
        },
      ],
    });
    const created = await splitRun(h, 'login');
    const base = git(h.repo, 'rev-parse', `refs/aip/${created.runId}/run`);
    const lock = join(h.repo, '.git', 'refs', 'aip', created.runId, 'run.lock');
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, '');
    h.open('split');
    const failed = await h.waitFor(created.runId, (view) => view.finished);
    expect(failed.split?.status).toBe('failed');
    expect(git(h.repo, 'rev-parse', `refs/aip/${created.runId}/run`)).toBe(base);

    // The commit of the failed attempt is still in the tree of the run: the retry commits it again.
    rmSync(lock);
    await h.call('retry', { runId: created.runId, group: '_split' });
    const final = await h.waitFor(created.runId, (view) => view.finished && view.groups.length > 0);
    expect(statuses(final)).toEqual(['merged']);
    const split = git(
      h.repo,
      'log',
      '--format=%H',
      '-1',
      '--grep=aip(_split/split)',
      `refs/aip/${created.runId}/run`,
    );
    expect(git(h.repo, 'rev-parse', `${split}^`)).toBe(base);
    expect(git(h.repo, 'log', '--format=%s', `refs/aip/${created.runId}/run`)).toContain(
      'aip(_split/split): split done',
    );
    expect(reads(h).find((entry) => entry.step === 'code')?.contents).toEqual({
      'openspec/changes/x/tasks.md': 'tasks of the change\n',
    });

    const applied = (await h.call('apply', { runId: created.runId })) as ApplyResult;
    expect(applied.groups[0]?.delivery.state).toBe('applied');
    expect(readFileSync(join(h.repo, 'openspec/changes/x/tasks.md'), 'utf8')).toBe(
      'tasks of the change\n',
    );
    expect(readFileSync(join(h.repo, 'login.ts'), 'utf8')).toBe('export const login = true;\n');
  });

  it('keeps what the failed attempt committed when the retry adds to the split', async () => {
    const h = await start();
    ignoreOpenspec(h);
    h.script({
      split: [
        {
          write: { 'openspec/changes/x/tasks.md': 'tasks of the change\n' },
          split: [{ title: 'Login', task: 'login' }],
          waitFor: h.gate('split'),
        },
        {
          write: { 'openspec/changes/x/specs.md': 'the spec of the change\n' },
          split: [{ title: 'Login', task: 'login' }],
        },
      ],
      code: [{ write: { 'login.ts': 'export const login = true;\n' } }],
    });
    const created = await splitRun(h, 'login');
    const base = git(h.repo, 'rev-parse', `refs/aip/${created.runId}/run`);
    const lock = join(h.repo, '.git', 'refs', 'aip', created.runId, 'run.lock');
    mkdirSync(dirname(lock), { recursive: true });
    writeFileSync(lock, '');
    h.open('split');
    await h.waitFor(created.runId, (view) => view.finished);
    rmSync(lock);
    await h.call('retry', { runId: created.runId, group: '_split' });
    const final = await h.waitFor(created.runId, (view) => view.finished && view.groups.length > 0);
    expect(statuses(final)).toEqual(['merged']);
    // One commit on the base carries both attempts: the delivery is the whole result of the split.
    const split = git(
      h.repo,
      'log',
      '--format=%H',
      '-1',
      '--grep=aip(_split/split)',
      `refs/aip/${created.runId}/run`,
    );
    expect(git(h.repo, 'rev-parse', `${split}^`)).toBe(base);

    const applied = (await h.call('apply', { runId: created.runId })) as ApplyResult;
    expect(applied.groups[0]?.delivery.state).toBe('applied');
    expect(readFileSync(join(h.repo, 'openspec/changes/x/tasks.md'), 'utf8')).toBe(
      'tasks of the change\n',
    );
    expect(readFileSync(join(h.repo, 'openspec/changes/x/specs.md'), 'utf8')).toBe(
      'the spec of the change\n',
    );
    expect(readFileSync(join(h.repo, 'login.ts'), 'utf8')).toBe('export const login = true;\n');
  });
});
