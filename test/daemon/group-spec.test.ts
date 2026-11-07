import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { GroupSpecView, RunCreated } from '../../src/presentation/ipc/contract/index.ts';

import { CODE_ONLY_CONFIG, git, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(): Promise<{ h: Harness }> {
  const h = (current = await harness(CODE_ONLY_CONFIG));
  return { h };
}

async function run(h: Harness): Promise<string> {
  const created = (await startRun(h, {
    repository: h.repo,
    pipeline: 'feature',
    groups: [{ title: 'Логин', task: 'добавить логин' }],
  })) as RunCreated;
  return created.runId;
}

async function spec(h: Harness, runId: string, group = 'login'): Promise<GroupSpecView | null> {
  return (await h.call('group_spec', { runId, group })) as GroupSpecView | null;
}

const TASKS = '# Tasks\n\n- [x] 1.1 one\n- [ ] 1.2 two\n';

describe('group_spec', () => {
  it('reads uncommitted design and tasks of a working group from its worktree', async () => {
    const { h } = await start();
    h.script({
      code: [
        {
          write: {
            'openspec/changes/add-login/design.md': '# Design\n',
            'openspec/changes/add-login/tasks.md': TASKS,
          },
          waitFor: h.gate('hold'),
        },
      ],
    });
    const runId = await run(h);
    let found: GroupSpecView | null = null;
    await until('the spec appears', async () => {
      found = await spec(h, runId);
      return found !== null;
    });
    expect(found).toEqual({
      change: 'add-login',
      path: 'openspec/changes/add-login',
      design: '# Design\n',
      tasks: TASKS,
    });
    h.open('hold');
    await h.waitFor(runId, (view) => view.finished);
  });

  it('answers null for a group without an OpenSpec change', async () => {
    const { h } = await start();
    h.script({ code: [{ write: { 'feature.ts': 'export {};\n' } }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    expect(await spec(h, runId)).toBeNull();
  });

  it('answers null for a change that already lies in the base', async () => {
    const { h } = await start();
    mkdirSync(join(h.repo, 'openspec/changes/old'), { recursive: true });
    writeFileSync(join(h.repo, 'openspec/changes/old/tasks.md'), TASKS);
    git(h.repo, 'add', '-A');
    git(h.repo, 'commit', '-q', '-m', 'old change');
    h.script({ code: [{ write: { 'feature.ts': 'export {};\n' } }] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    expect(await spec(h, runId)).toBeNull();
  });

  it('gives design null when the change has only tasks, and reads a merged group from its commit', async () => {
    const { h } = await start();
    h.script({
      code: [{ write: { 'openspec/changes/only-tasks/tasks.md': TASKS } }],
    });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    const group = (await h.call('group', { runId, group: 'login', tailLines: 1 })) as {
      status: string;
      worktree: string | null;
    };
    expect(group.status).toBe('merged');
    if (group.worktree !== null) rmSync(group.worktree, { recursive: true, force: true });
    expect(group.worktree === null || !existsSync(group.worktree)).toBe(true);
    expect(await spec(h, runId)).toEqual({
      change: 'only-tasks',
      path: 'openspec/changes/only-tasks',
      design: null,
      tasks: TASKS,
    });
  });

  it('finds an archived change', async () => {
    const { h } = await start();
    h.script({
      code: [{ write: { 'openspec/changes/archive/2026-11-04-done/design.md': 'D\n' } }],
    });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    expect(await spec(h, runId)).toMatchObject({ change: '2026-11-04-done', design: 'D\n' });
  });

  it('rejects an unknown group', async () => {
    const { h } = await start();
    h.script({ code: [{}] });
    const runId = await run(h);
    await h.waitFor(runId, (view) => view.finished);
    await expect(spec(h, runId, 'nope')).rejects.toThrow('unknown group');
  });
});
