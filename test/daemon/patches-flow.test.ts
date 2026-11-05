import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { FileDiffView, RunCreated, RunPatchView } from '../../src/protocol/index.ts';

import { CODE_ONLY_CONFIG, git, harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

const WRITE_LIB = { code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] };

async function finishedRun(h: Harness): Promise<string> {
  h.script(WRITE_LIB);
  const { runId } = (await startRun(h, {
    repository: h.repo,
    workflow: 'feature',
    groups: [{ title: 'Вход', task: 'вход' }],
  })) as RunCreated;
  await h.waitFor(runId, (view) => view.finished);
  return runId;
}

const text = (patch: RunPatchView) => Buffer.from(patch.base64, 'base64').toString('utf8');

describe('patch of a run', () => {
  it('is saved on merge and downloadable before and after the cleanup', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    const h = current;
    const runId = await finishedRun(h);
    const before = (await h.call('run_patch', { runId })) as RunPatchView;
    expect(before.fileName).toBe(`${runId}.patch`);
    expect(text(before)).toContain('+export const value = 2;');
    const record = h.running.daemon.store.runPatch(runId);
    expect(record?.uri).toMatch(/^file:\/\/\//);
    expect(record?.size).toBe(before.size);
    expect(existsSync(join(h.state, 'patches', runId, `${record?.commit}.patch`))).toBe(true);
    // the file applies on the base of the run
    const file = join(h.state, 'check.patch');
    writeFileSync(file, Buffer.from(before.base64, 'base64'));
    git(h.repo, 'apply', '--check', file);

    await h.call('apply', { runId });
    expect(git(h.repo, 'for-each-ref', 'refs/aip/')).toBe('');
    const after = (await h.call('run_patch', { runId })) as RunPatchView;
    expect(after.base64).toBe(before.base64);
    expect(h.running.daemon.store.runPatch(runId)?.commit).toBe(record?.commit);
  });

  it('is saved before the cleanup although nobody asked for it', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: true }\n`);
    const h = current;
    const runId = await finishedRun(h);
    await h.waitFor(runId, (view) => view.delivery.applied === 1);
    const patch = (await h.call('run_patch', { runId })) as RunPatchView;
    expect(text(patch)).toContain('lib.ts');
    expect(readdirSync(join(h.state, 'patches', runId))).toHaveLength(1);
  });

  it('refuses a run without merged changes and a run whose patch is gone', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    const h = current;
    const runId = await finishedRun(h);
    await h.call('apply', { runId });
    h.running.daemon.store.database.prepare('DELETE FROM run_patches').run();
    await expect(h.call('run_patch', { runId })).rejects.toThrow('run refs are removed');
    await expect(h.call('run_patch', { runId: 'unknown' })).rejects.toThrow('unknown run');
  });

  it('does not block the merge when the storage is unwritable, and builds the patch on demand', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    const h = current;
    writeFileSync(join(h.state, 'patches'), 'not a directory');
    const runId = await finishedRun(h);
    expect((await h.status(runId)).delivery.merged).toBe(1);
    const patch = (await h.call('run_patch', { runId })) as RunPatchView;
    expect(text(patch)).toContain('+export const value = 2;');
  });

  it('removes patches of unknown runs when the daemon starts', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    const h = current;
    const runId = await finishedRun(h);
    await h.call('run_patch', { runId });
    mkdirSync(join(h.state, 'patches', 'ghost'), { recursive: true });
    writeFileSync(join(h.state, 'patches', 'ghost', 'x.patch'), 'x');
    await h.restart();
    expect(existsSync(join(h.state, 'patches', 'ghost'))).toBe(false);
    expect(existsSync(join(h.state, 'patches', runId))).toBe(true);
  });
});

describe('diff of a file of a group', () => {
  it('returns the hunk of a changed file and refuses others', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    const h = current;
    const runId = await finishedRun(h);
    const diff = (await h.call('group_file_diff', {
      runId,
      group: 'vhod',
      path: 'lib.ts',
    })) as FileDiffView;
    expect(diff).toMatchObject({
      path: 'lib.ts',
      previousPath: null,
      binary: false,
      truncated: false,
    });
    expect(diff.lines).toContain('-export const value = 1;');
    expect(diff.lines).toContain('+export const value = 2;');
    expect(diff.lines.some((line) => line.startsWith('diff --git'))).toBe(false);
    await expect(
      h.call('group_file_diff', { runId, group: 'vhod', path: 'other.ts' }),
    ).rejects.toThrow('is not changed in group');
    await expect(
      h.call('group_file_diff', { runId, group: 'nope', path: 'lib.ts' }),
    ).rejects.toThrow('unknown group');
  });

  it('answers a binary file without a diff', async () => {
    current = await harness(`${CODE_ONLY_CONFIG}  delivery: { auto: false }\n`);
    const h = current;
    h.script({ code: [{ write: { 'logo.bin': '\u0000\u0001\u0002' } }] });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      workflow: 'feature',
      groups: [{ title: 'Вход', task: 'вход' }],
    })) as RunCreated;
    await h.waitFor(runId, (view) => view.finished);
    const diff = (await h.call('group_file_diff', {
      runId,
      group: 'vhod',
      path: 'logo.bin',
    })) as FileDiffView;
    expect(diff).toMatchObject({ binary: true, lines: [], totalLines: 0 });
  });
});
