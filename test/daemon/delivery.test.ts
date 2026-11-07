import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { databasePath } from '../../src/platform/paths/index.ts';
import type { ApplyResult, RunCreated } from '../../src/protocol/index.ts';
import { openStorage } from '../feature/storage.ts';

import { POLL_MS, CODE_ONLY_CONFIG, git, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(extra = '  delivery: { auto: false }\n'): Promise<Harness> {
  current = await harness(`${CODE_ONLY_CONFIG}${extra}`);
  return current;
}

async function finishedRun(
  h: Harness,
  groups = [{ title: 'Вход', task: 'вход' }],
): Promise<string> {
  const { runId } = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups,
  })) as RunCreated;
  await h.waitFor(runId, (view) => view.finished);
  return runId;
}

const WRITE_LIB = { code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] };

describe('delivery through the daemon', () => {
  it('delivers into the working tree, cleans up and leaves no branches or commits', async () => {
    const h = await start();
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    const head = git(h.repo, 'rev-parse', 'HEAD');
    const result = (await h.call('apply', { runId })) as ApplyResult;
    expect(result.groups).toEqual([
      {
        slug: 'vhod',
        delivery: {
          state: 'applied',
          reason: null,
          files: ['lib.ts'],
          conflicts: [],
          userEdits: [],
          manual: false,
          finishedAt: expect.any(Number),
        },
      },
    ]);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
    expect(git(h.repo, 'status', '--porcelain')).toBe('M lib.ts');
    expect(git(h.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(h.repo, 'branch', '--list', 'aip/*')).toBe('');
    expect(git(h.repo, 'for-each-ref', 'refs/aip/')).toBe('');
    expect((await h.status(runId)).delivery).toMatchObject({ applied: 1, merged: 1 });
    await expect(h.call('apply', { runId, groups: ['vhod'] })).rejects.toThrow('already delivered');
  });

  it('refuses when the user edits the same file and applies with markers when forced', async () => {
    const h = await start();
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    writeFileSync(join(h.repo, 'lib.ts'), 'export const value = 9;\n');
    expect((await h.status(runId)).delivery.finishedAt).toBeNull();
    const refused = (await h.call('apply', { runId })) as ApplyResult;
    expect(refused.pending).toBe(false);
    expect(refused.groups[0]?.delivery).toMatchObject({ state: 'apply_failed', files: ['lib.ts'] });
    const first = refused.groups[0]!.delivery.finishedAt!;
    expect(typeof first).toBe('number');
    expect((await h.status(runId)).delivery.finishedAt).toBe(first);
    // the second delivery must carry a later time stamp (milliseconds)
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = (await h.call('apply', { runId })) as ApplyResult;
    expect(again.groups[0]?.delivery.reason).toBe(refused.groups[0]?.delivery.reason);
    expect(again.groups[0]!.delivery.finishedAt!).toBeGreaterThan(first);
    expect((await h.status(runId)).delivery.finishedAt).toBe(again.groups[0]!.delivery.finishedAt);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 9;\n');
    const forced = (await h.call('apply', { runId, force: true })) as ApplyResult;
    expect(forced.groups[0]?.delivery).toMatchObject({ state: 'applied', conflicts: ['lib.ts'] });
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toContain('<<<<<<<');
  });

  it('marks a run with a refused delivery as delivered by hand and cleans up', async () => {
    const h = await start();
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    writeFileSync(join(h.repo, 'lib.ts'), 'export const value = 9;\n');
    await h.call('apply', { runId });
    expect((await h.status(runId)).deliveryStage).toMatchObject({ status: 'apply_failed' });
    const result = (await h.call('run_mark_delivered', { runId })) as ApplyResult;
    expect(result.pending).toBe(false);
    expect(result.groups).toEqual([
      {
        slug: 'vhod',
        delivery: {
          state: 'applied',
          reason: null,
          files: [],
          conflicts: [],
          userEdits: [],
          manual: true,
          finishedAt: expect.any(Number),
        },
      },
    ]);
    const view = await h.status(runId);
    expect(view.deliveryStage).toEqual({ status: 'applied', manual: true });
    expect(view.delivery).toMatchObject({ applied: 1, merged: 1, failed: 0 });
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 9;\n');
    expect(git(h.repo, 'branch', '--list', 'aip/*')).toBe('');
    expect(git(h.repo, 'for-each-ref', 'refs/aip/')).toBe('');
    await expect(h.call('run_mark_delivered', { runId })).rejects.toThrow('nothing to mark');
    await expect(h.call('run_mark_delivered', { runId, groups: ['vhod'] })).rejects.toThrow(
      'already delivered',
    );
  });

  it('keeps the result of a manually delivered run with delivery.keep', async () => {
    const h = await start('  delivery: { auto: false, keep: true }\n');
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    await h.call('run_mark_delivered', { runId, groups: ['vhod'] });
    expect(git(h.repo, 'for-each-ref', 'refs/aip/')).toContain(`refs/aip/${runId}/`);
    expect((await h.status(runId)).deliveryStage).toEqual({ status: 'applied', manual: true });
  });

  it('refuses to mark an unknown run', async () => {
    const h = await start();
    await expect(h.call('run_mark_delivered', { runId: 'nope' })).rejects.toThrow();
  });

  it('commits with a message written by the message specialist', async () => {
    const h = await start(
      '  delivery: { mode: commit, auto: false, message_specialist: reviewer }\n',
    );
    h.script({ ...WRITE_LIB, message: [{ summary: 'feat: вход\n\nдобавлен вход' }] });
    const runId = await finishedRun(h);
    const result = (await h.call('apply', { runId })) as ApplyResult;
    expect(result.pending).toBe(true);
    await h.waitFor(runId, (view) => view.delivery.applied === 1);
    expect(git(h.repo, 'log', '-1', '--format=%B')).toBe('feat: вход\n\nдобавлен вход');
    expect(git(h.repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('lib.ts');
  });

  it('delivers a run with autoDeliver true although delivery.auto is off', async () => {
    const h = await start();
    h.script(WRITE_LIB);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
      autoDeliver: true,
    })) as RunCreated;
    expect((await h.status(runId)).autoDeliver).toBe(true);
    await h.waitFor(runId, (view) => view.groups.every((group) => group.delivery === 'applied'));
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
  });

  it('leaves a run with autoDeliver false for apply although delivery.auto is on', async () => {
    const h = await start('  delivery: { auto: true }\n');
    h.script(WRITE_LIB);
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
      autoDeliver: false,
    })) as RunCreated;
    const view = await h.waitFor(runId, (run) => run.finished);
    expect(view.autoDeliver).toBe(false);
    expect(view.groups.map((group) => group.delivery)).toEqual(['pending']);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 1;\n');
  });

  it('delivers automatically with delivery.auto', async () => {
    const h = await start('  delivery: { auto: true, keep: true }\n');
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    await h.waitFor(runId, (view) => view.delivery.applied === 1);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
    expect(git(h.repo, 'for-each-ref', '--format=%(refname)', 'refs/aip/')).toContain(
      `refs/aip/${runId}/run`,
    );
  });

  it('starts again a delivery cut off by a daemon restart', async () => {
    const h = await start();
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    await h.restart(() => {
      // The daemon stopped after it recorded the delivery and before it did the git work.
      const store = openStorage(databasePath(h.state));
      const state = store.runs.loadRun(runId)!;
      state.run.pendingDelivery = { groups: ['vhod'], force: false, auto: true };
      store.runs.saveRun(state);
      store.database.close();
    });
    const final = await h.waitFor(runId, (view) => view.delivery.applied === 1);
    expect(final.delivery.inProgress).toBe(false);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
  });

  it('delivers as a visible branch in branch mode', async () => {
    const h = await start('  delivery: { mode: branch, auto: false }\n');
    h.script(WRITE_LIB);
    const runId = await finishedRun(h);
    await h.call('apply', { runId });
    expect(git(h.repo, 'branch', '--list', 'aip/*')).toBe(`aip/${runId}`);
    expect(git(h.repo, 'show', `aip/${runId}:lib.ts`)).toBe('export const value = 2;');
    expect(git(h.repo, 'status', '--porcelain')).toBe('');
  });
});

describe('runs from the working tree', () => {
  async function dirty(h: Harness): Promise<string> {
    writeFileSync(join(h.repo, '.gitignore'), 'openspec/\n');
    git(h.repo, 'add', '.gitignore');
    git(h.repo, 'commit', '-q', '-m', 'ignore openspec');
    writeFileSync(join(h.repo, 'lib.ts'), 'export const value = 5;\n');
    writeFileSync(join(h.repo, 'notes.md'), 'notes\n');
    mkdirSync(join(h.repo, 'openspec'));
    writeFileSync(join(h.repo, 'openspec', 'plan.md'), 'plan\n');
    return git(h.repo, 'rev-parse', 'HEAD');
  }

  it('sees uncommitted work and ignored include paths, and delivers by itself', async () => {
    const h = await start('  workspace: { include: [openspec/] }\n');
    const head = await dirty(h);
    h.script({
      code: [
        {
          read: ['lib.ts', 'notes.md', 'openspec/plan.md'],
          write: { 'feature.ts': 'export const on = true;\n', 'openspec/tasks.md': 'tasks\n' },
        },
      ],
    });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    expect(created.warnings).toEqual([]);
    await h.waitFor(created.runId, (view) => view.delivery.applied === 1);
    const reads = readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(reads[0] ?? '{}').contents).toEqual({
      'lib.ts': 'export const value = 5;\n',
      'notes.md': 'notes\n',
      'openspec/plan.md': 'plan\n',
    });
    expect(readFileSync(join(h.repo, 'feature.ts'), 'utf8')).toBe('export const on = true;\n');
    expect(readFileSync(join(h.repo, 'openspec', 'tasks.md'), 'utf8')).toBe('tasks\n');
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 5;\n');
    expect(git(h.repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(h.repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(h.repo, 'status', '--porcelain')).toBe('M lib.ts\n?? feature.ts\n?? notes.md');
    for (let tries = 0; tries < 50 && git(h.repo, 'for-each-ref', 'refs/aip/') !== ''; tries += 1)
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    expect(git(h.repo, 'for-each-ref', 'refs/aip/')).toBe('');
  });

  it('warns and leaves uncommitted work out with workspace.base: head', async () => {
    const h = await start('  workspace: { base: head }\n  delivery: { auto: false }\n');
    await dirty(h);
    h.script({ code: [{ read: ['lib.ts', 'notes.md'] }] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    expect(created.warnings).toEqual([
      'the repository has uncommitted changes; they are not part of this run',
    ]);
    await h.waitFor(created.runId, (view) => view.finished);
    const reads = readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(reads[0] ?? '{}').contents).toEqual({
      'lib.ts': 'export const value = 1;\n',
      'notes.md': null,
    });
    expect(existsSync(join(h.repo, 'feature.ts'))).toBe(false);
  });
});

describe('delivery resolver', () => {
  async function conflictingRun(h: Harness, resolve: unknown[]): Promise<string> {
    h.script({
      // the coder goes on once the user's edit below is in the working tree
      code: [{ waitFor: h.gate('code'), write: { 'lib.ts': 'export const value = 2;\n' } }],
      resolve,
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    writeFileSync(join(h.repo, 'lib.ts'), 'export const value = 9;\n');
    h.open('code');
    await h.waitFor(
      runId,
      (view) => view.finished && !view.delivery.inProgress && view.delivery.merged === 1,
      20_000,
    );
    return runId;
  }

  function resolverReads(h: Harness): Record<string, string | null>[] {
    return readFileSync(join(h.fakeState, 'reads.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { step: string; contents: Record<string, string | null> })
      .filter((entry) => entry.step === 'resolve')
      .map((entry) => entry.contents);
  }

  it('lets the resolver settle a conflict with the working tree and delivers by itself', async () => {
    const h = await start('  delivery: { resolver: coder }\n');
    const runId = await conflictingRun(h, [
      { read: ['lib.ts'], write: { 'lib.ts': 'export const value = 7;\n' } },
    ]);
    const [contents] = resolverReads(h);
    expect(contents?.['lib.ts']).toContain('<<<<<<<');
    expect(contents?.['lib.ts']).toContain('export const value = 9;');
    expect(contents?.['lib.ts']).toContain('export const value = 2;');
    expect((await h.status(runId)).delivery).toMatchObject({ applied: 1, failed: 0 });
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 7;\n');
    expect(git(h.repo, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('fails the delivery when conflict markers remain and keeps the working tree', async () => {
    const h = await start('  delivery: { resolver: coder }\n');
    const runId = await conflictingRun(h, [{ summary: 'готово' }]);
    const view = await h.group(runId, 'vhod');
    expect(view.delivery).toMatchObject({
      state: 'apply_failed',
      reason: 'conflict markers remain in: lib.ts',
      files: ['lib.ts'],
    });
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 9;\n');
  });

  it('starts a second round from a fresh snapshot when the tree changed again', async () => {
    const h = await harness(
      `${CODE_ONLY_CONFIG}  delivery: { resolver: coder, resolver_rounds: 2 }\n`,
    );
    current = h;
    const runId = await conflictingRun(h, [
      {
        write: { 'lib.ts': 'export const value = 7;\n' },
        outside: { [join(h.repo, 'lib.ts')]: 'export const value = 10;\n' },
      },
      { read: ['lib.ts'], write: { 'lib.ts': 'export const value = 8;\n' } },
    ]);
    const reads = resolverReads(h);
    expect(reads.at(-1)?.['lib.ts']).toContain('export const value = 10;');
    expect((await h.status(runId)).delivery).toMatchObject({ applied: 1 });
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 8;\n');
  });
});

describe('diff statistics', () => {
  it('reports the files and lines of groups and of the run', async () => {
    const h = await start();
    h.script({
      code: [{ write: { 'lib.ts': 'export const value = 2;\n', 'extra.ts': 'a\nb\n' } }],
    });
    const runId = await finishedRun(h);
    const view = await h.waitFor(runId, (run) => run.diff !== null);
    expect(view.diff).toEqual({ files: 2, added: 3, removed: 1 });
    expect(view.groups[0]?.diff).toEqual({ files: 2, added: 3, removed: 1 });
    expect(view.title).toBe('вход');
    expect((await h.group(runId, 'vhod')).diff?.files).toEqual([
      { path: 'extra.ts', added: 2, removed: 0 },
      { path: 'lib.ts', added: 1, removed: 1 },
    ]);
  });
});
