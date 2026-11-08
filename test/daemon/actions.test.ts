import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  RunCreated,
  RunView,
  SystemStagesView,
  PipelinesView,
} from '../../src/presentation/ipc/contract/index.ts';

import { git, harness, startRun, until, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

/** A pipeline with a split and one step; `extra` adds actions, stages and delivery settings. */
function configWith(extra: string): string {
  return `swarm:
  max: 3
  specialists:
    coder: { name: Кодировщик }
${extra}
  pipelines:
    feature:
      split: { specialist: coder, max_groups: 3 }
      steps:
        - { id: code, specialist: coder }
    plain:
      steps:
        - { id: code, specialist: coder }
`;
}

async function start(extra: string): Promise<Harness> {
  current = await harness(configWith(extra));
  return current;
}

const SPLIT_TWO = {
  split: [
    {
      split: [
        { title: 'Первая', task: 'первая' },
        { title: 'Вторая', task: 'вторая' },
      ],
    },
  ],
};

function system(run: RunView) {
  return run.system.map(
    (row) => `${row.kind}:${row.point ?? ''}:${row.action ?? ''}:${row.status}`,
  );
}

async function plainRun(h: Harness): Promise<string> {
  const created = (await startRun(h, {
    repository: h.repo,
    pipeline: 'plain',
    groups: [{ title: 'Вход', task: 'вход' }],
  })) as RunCreated;
  return created.runId;
}

describe('actions before the split', () => {
  it('runs in the tree of the run and its changes reach the split and the groups', async () => {
    const h = await start(`  actions:
    plan: { run: "echo planned > plan.md" }
  stages:
    before_split: [plan]
  delivery: { auto: false }`);
    h.script({ ...SPLIT_TWO, code: [{}, {}] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'сделать',
    })) as RunCreated;
    const view = await h.waitFor(created.runId, (run) => run.finished);
    expect(system(view)).toEqual(['action:before_split:plan:done', 'split:::done']);
    const tree = git(h.repo, 'ls-tree', '--name-only', `refs/aip/${created.runId}/run`);
    expect(tree.split('\n')).toContain('plan.md');
    // The groups start from the run ref, so they have the file too.
    const slug = view.groups[0]?.slug ?? '';
    const files = git(h.repo, 'ls-tree', '--name-only', `refs/aip/${created.runId}/groups/${slug}`);
    expect(files.split('\n')).toContain('plan.md');
  });

  it('holds the split until the action is done', async () => {
    const h = await start(`  actions:
    plan: { run: "while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    before_split: [plan]
  delivery: { auto: false }`);
    h.script({ ...SPLIT_TWO, code: [{}, {}] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'сделать',
    })) as RunCreated;
    await h.waitFor(created.runId, (run) => run.system[0]?.status === 'running');
    const waiting = await h.status(created.runId);
    expect(waiting.system.map((row) => row.status)).toEqual(['running', 'queued']);
    writeFileSync(join(h.repo, '..', 'go'), '');
    const view = await h.waitFor(created.runId, (run) => run.finished);
    expect(view.groups).toHaveLength(2);
  });

  it('stops the run at a failed action and goes on after a retry', async () => {
    const h = await start(`  actions:
    plan: { run: "test -f ${'$'}AIP_REPOSITORY/../ok" }
  stages:
    before_split: [plan]
  delivery: { auto: false }`);
    h.script({ ...SPLIT_TWO, code: [{}, {}] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'сделать',
    })) as RunCreated;
    const failed = await h.waitFor(created.runId, (run) => run.system[0]?.status === 'failed');
    expect(failed.system[0]?.reason).toBe('exit code 1');
    expect(failed.system[1]?.status).toBe('queued');
    expect(failed.finished).toBe(true);
    const slug = '_action-before-split-plan';
    const log = await h.group(created.runId, slug);
    expect(log.attempts[0]?.reason).toBe('exit code 1');
    writeFileSync(join(h.repo, '..', 'ok'), '');
    await h.call('retry', { runId: created.runId, group: slug });
    const view = await h.waitFor(created.runId, (run) => run.finished && run.groups.length === 2);
    expect(view.system.map((row) => row.status)).toEqual(['done', 'done']);
  });
});

describe('actions after the split', () => {
  it('keep the groups queued until the action is done', async () => {
    const h = await start(`  actions:
    prepare: { run: "while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    after_split: [prepare]
  delivery: { auto: false }`);
    h.script({ ...SPLIT_TWO, code: [{}, {}] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'сделать',
    })) as RunCreated;
    const waiting = await h.waitFor(
      created.runId,
      (run) => run.groups.length === 2 && run.system.some((row) => row.status === 'running'),
    );
    expect(waiting.groups.map((group) => group.status)).toEqual(['queued', 'queued']);
    writeFileSync(join(h.repo, '..', 'go'), '');
    const view = await h.waitFor(created.runId, (run) => run.finished);
    expect(view.groups.map((group) => group.status)).toEqual(['merged', 'merged']);
  });

  it('is skipped by a pipeline without a split', async () => {
    const h = await start(`  actions:
    prepare: { run: "true" }
  stages:
    after_split: [prepare]
  delivery: { auto: false }`);
    const runId = await plainRun(h);
    const view = await h.waitFor(runId, (run) => run.finished);
    expect(view.system).toEqual([]);
  });
});

describe('actions before delivery', () => {
  it('check the merged tree and drop what they change', async () => {
    const h = await start(`  actions:
    lint: { run: "echo checked > ${'$'}AIP_REPOSITORY/../checked && echo junk > lib.ts" }
  stages:
    before_delivery: [lint]
  delivery: { auto: false }`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('apply', { runId });
    const view = await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(system(view)).toEqual(['action:before_delivery:lint:done']);
    expect(existsSync(join(h.repo, '..', 'checked'))).toBe(true);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
  });

  it('cancel the delivery when they fail and run again at the next request', async () => {
    const h = await start(`  actions:
    check: { run: "echo run >> ${'$'}AIP_REPOSITORY/../count; test -f ${'$'}AIP_REPOSITORY/../ok" }
  stages:
    before_delivery: [check]
  delivery: { auto: false }`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('apply', { runId });
    const failed = await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    expect(failed.delivery.inProgress).toBe(false);
    expect(failed.delivery.applied).toBe(0);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 1;\n');
    writeFileSync(join(h.repo, '..', 'ok'), '');
    await h.call('apply', { runId });
    const view = await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(view.delivery.applied).toBe(1);
    expect(
      readFileSync(join(h.repo, '..', 'count'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(2);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
  });

  it('go on after a failure that is allowed', async () => {
    const h = await start(`  actions:
    check: { run: "exit 3", on_failure: continue }
  stages:
    before_delivery: [check]
  delivery: { auto: false }`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('apply', { runId });
    const view = await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(view.system[0]?.status).toBe('failed');
    expect(view.system[0]?.reason).toBe('exit code 3');
  });

  it('run on automatic delivery before the files change', async () => {
    const h = await start(`  actions:
    check: { run: "cat lib.ts > ${'$'}AIP_REPOSITORY/../seen; cat ${'$'}AIP_REPOSITORY/lib.ts > ${'$'}AIP_REPOSITORY/../user" }
  stages:
    before_delivery: [check]`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(readFileSync(join(h.repo, '..', 'seen'), 'utf8')).toBe('export const value = 2;\n');
    // The files of the user have not changed yet when the check runs.
    expect(readFileSync(join(h.repo, '..', 'user'), 'utf8')).toBe('export const value = 1;\n');
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
  });

  it('drop a commit of the check: the tree of the run stays on its ref', async () => {
    // Inspect the reset worktree after delivery without racing automatic cleanup.
    const h = await start(`  actions:
    lint: { run: "echo x > extra.txt && git add -A && git -c user.name=a -c user.email=a@b commit -q -m check" }
  stages:
    before_delivery: [lint]
  delivery: { auto: false, keep: true }`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    const ref = `refs/aip/${runId}/run`;
    const mergedHead = git(h.repo, 'rev-parse', ref);
    await h.call('apply', { runId });
    await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    const tree = join(h.repo, '.aip', 'worktrees', runId, '_run');
    expect(existsSync(tree)).toBe(true);
    expect(git(tree, 'rev-parse', 'HEAD')).toBe(mergedHead);
    expect(git(h.repo, 'rev-parse', ref)).toBe(mergedHead);
    expect(existsSync(join(tree, 'extra.txt'))).toBe(false);
    expect(existsSync(join(h.repo, 'extra.txt'))).toBe(false);
  });

  /** The first group is delivered, its check has committed a file of the second group and works on. */
  async function mergeHeldByCheck(): Promise<{ h: Harness; runId: string }> {
    const h = await start(`  actions:
    check: { run: "echo junk > second.ts && git add -A && git -c user.name=a -c user.email=a@b commit -q -m check && touch ${'$'}AIP_REPOSITORY/../started; while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    before_delivery: [check]
  delivery: { auto: false }`);
    h.script({
      code: [
        { write: { 'first.ts': 'first\n' } },
        { waitFor: h.gate('second'), write: { 'second.ts': 'second\n' } },
      ],
    });
    const { runId } = (await startRun(h, {
      repository: h.repo,
      pipeline: 'plain',
      groups: [
        { title: 'Первая', task: 'первая' },
        { title: 'Вторая', task: 'вторая' },
      ],
    })) as RunCreated;
    const merged = await h.waitFor(runId, (run) =>
      run.groups.some((group) => group.status === 'merged'),
    );
    const first = merged.groups.find((group) => group.status === 'merged')!;
    await h.call('apply', { runId, groups: [first.slug] });
    await until('the check', () => existsSync(join(h.repo, '..', 'started')));
    h.open('second');
    await h.waitFor(runId, (run) => run.groups.some((group) => group.status === 'merging'));
    return { h, runId };
  }

  /** The second group merges on the ref of the run, without the commit of the check. */
  async function expectCleanMerge(h: Harness, runId: string): Promise<void> {
    await h.waitFor(runId, (run) => run.groups.every((group) => group.status === 'merged'));
    const ref = `refs/aip/${runId}/run`;
    expect(git(h.repo, 'log', '--format=%s', ref).split('\n')).not.toContain('check');
    expect(git(h.repo, 'show', `${ref}:second.ts`)).toBe('second');
  }

  it('hold the merge of another group until they end, and keep their commit out of it', async () => {
    const { h, runId } = await mergeHeldByCheck();
    writeFileSync(join(h.repo, '..', 'go'), '');
    await expectCleanMerge(h, runId);
  });

  it('keep their commit out of the merge when a restart cuts them off', async () => {
    const { h, runId } = await mergeHeldByCheck();
    await h.restart();
    await expectCleanMerge(h, runId);
  });

  it('keep their commit out of the merge when they are cancelled', async () => {
    const { h, runId } = await mergeHeldByCheck();
    await h.call('cancel', { runId, group: '_action-before-delivery-check' });
    await expectCleanMerge(h, runId);
  });

  it('drop what an interrupted check wrote before the next one', async () => {
    const h = await start(`  actions:
    check: { run: "if [ -f junk.txt ]; then echo seen >> ${'$'}AIP_REPOSITORY/../seen; fi; echo x > junk.txt; echo run >> ${'$'}AIP_REPOSITORY/../count; while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    before_delivery: [check]
  delivery: { auto: false }`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('apply', { runId });
    await until('the first check', () => existsSync(join(h.repo, '..', 'count')));
    await h.restart();
    await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    writeFileSync(join(h.repo, '..', 'go'), '');
    await h.call('apply', { runId });
    await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(existsSync(join(h.repo, '..', 'seen'))).toBe(false);
  });
});

describe('actions before an automatic delivery', () => {
  const count = (h: Harness) =>
    readFileSync(join(h.repo, '..', 'count'), 'utf8')
      .trim()
      .split('\n').length;
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const WAITING = `  actions:
    check: { run: "echo run >> ${'$'}AIP_REPOSITORY/../count; while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    before_delivery: [check]`;

  it('does not run a failed check again', async () => {
    const h = await start(`  actions:
    check: { run: "echo run >> ${'$'}AIP_REPOSITORY/../count; exit 1" }
  stages:
    before_delivery: [check]`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    await pause(500);
    expect(count(h)).toBe(1);
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 1;\n');
  });

  it('does not run a cancelled check again', async () => {
    const h = await start(WAITING);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await until('the check', () => existsSync(join(h.repo, '..', 'count')));
    await h.call('cancel', { runId, group: '_action-before-delivery-check' });
    await h.waitFor(runId, (run) => run.system[0]?.status === 'cancelled');
    await pause(500);
    expect(count(h)).toBe(1);
  });

  it('does not run a check cut off by a restart again', async () => {
    const h = await start(WAITING);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'running');
    await until('the count', () => existsSync(join(h.repo, '..', 'count')));
    await h.restart();
    const view = await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    expect(view.system[0]?.reason).toBe('interrupted');
    await pause(500);
    expect(count(h)).toBe(1);
  });

  it('does not run an interrupted check again when its failure is allowed', async () => {
    const h = await start(WAITING.replace('check: { run:', 'check: { on_failure: continue, run:'));
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'running');
    await until('the count', () => existsSync(join(h.repo, '..', 'count')));
    await h.restart();
    await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    await pause(500);
    expect(count(h)).toBe(1);
    const view = await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(view.deliveryStage?.status).toBe('applied');
  });
});

describe('actions after delivery', () => {
  const COMMIT = `  actions:
    commit:
      run: git add -A && git commit -q -m "$AIP_COMMIT_MESSAGE" && printf '%s' "$AIP_CHANGED_FILES" > ../changed && printf '%s' "$AIP_DELIVERY_MODE" > ../mode
  stages:
    after_delivery: [commit]`;

  it('commit the delivered result with the message and the environment of the delivery', async () => {
    const h = await start(COMMIT);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'done');
    await until('the cleanup', () => !existsSync(join(h.repo, '.aip', 'worktrees', runId)));
    const message = git(h.repo, 'log', '-1', '--format=%B');
    expect(message).toContain('Вход');
    expect(git(h.repo, 'status', '--porcelain', '--', 'lib.ts')).toBe('');
    expect(readFileSync(join(h.repo, '..', 'changed'), 'utf8')).toBe('lib.ts');
    expect(readFileSync(join(h.repo, '..', 'mode'), 'utf8')).toBe('worktree');
  });

  it('keep the worktree while the command runs and clean up after it', async () => {
    const h = await start(`  actions:
    wait: { run: "while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    after_delivery: [wait]`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'running');
    const worktrees = join(h.repo, '.aip', 'worktrees', runId);
    expect(existsSync(worktrees)).toBe(true);
    writeFileSync(join(h.repo, '..', 'go'), '');
    await until('the cleanup', () => !existsSync(worktrees));
  });

  it('keep the run and defer the cleanup when the command fails, until a retry', async () => {
    const h = await start(`  actions:
    push: { run: "test -f ${'$'}AIP_REPOSITORY/../ok" }
  stages:
    after_delivery: [push]`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    const failed = await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    expect(failed.delivery.applied).toBe(1);
    expect(existsSync(join(h.repo, '.aip', 'worktrees', runId))).toBe(true);
    expect(git(h.repo, 'for-each-ref', `refs/aip/${runId}/`)).not.toBe('');
    writeFileSync(join(h.repo, '..', 'ok'), '');
    await h.call('retry', { runId, group: '_action-after-delivery-push' });
    await until('the cleanup', () => !existsSync(join(h.repo, '.aip', 'worktrees', runId)));
    await until('the refs', () => git(h.repo, 'for-each-ref', `refs/aip/${runId}/`) === '');
  });

  it('release the cleanup when the failed action is cancelled', async () => {
    const h = await start(`  actions:
    push: { run: "exit 1" }
  stages:
    after_delivery: [push]`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    await h.call('cancel', { runId, group: '_action-after-delivery-push' });
    await until('the cleanup', () => !existsSync(join(h.repo, '.aip', 'worktrees', runId)));
  });

  it('do not run after a delivery marked by hand', async () => {
    const h = await start(`  actions:
    push: { run: "touch ${'$'}AIP_REPOSITORY/../ran" }
  stages:
    after_delivery: [push]
  delivery: { auto: false }`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('run_mark_delivered', { runId, groups: [] });
    await until('the cleanup', () => !existsSync(join(h.repo, '.aip', 'worktrees', runId)));
    expect(existsSync(join(h.repo, '..', 'ran'))).toBe(false);
    expect((await h.status(runId)).system).toEqual([]);
  });

  it('run once, after the last of the groups is delivered', async () => {
    const h = await start(`  actions:
    push: { run: "echo run >> ${'$'}AIP_REPOSITORY/../count" }
  stages:
    after_delivery: [push]
  delivery: { auto: false }`);
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'plain',
      groups: [
        { title: 'Первая', task: 'первая' },
        { title: 'Вторая', task: 'вторая' },
      ],
    })) as RunCreated;
    h.script({
      code: [{ write: { 'a.ts': 'a\n' } }, { write: { 'b.ts': 'b\n' } }],
    });
    await h.waitFor(created.runId, (run) => run.finished);
    const slugs = (await h.status(created.runId)).groups.map((group) => group.slug);
    await h.call('apply', { runId: created.runId, groups: [slugs[0] ?? ''] });
    await h.waitFor(created.runId, (run) => run.delivery.applied === 1);
    expect(existsSync(join(h.repo, '..', 'count'))).toBe(false);
    await h.call('apply', { runId: created.runId, groups: [slugs[1] ?? ''] });
    await h.waitFor(created.runId, (run) => run.system[0]?.status === 'done');
    expect(
      readFileSync(join(h.repo, '..', 'count'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });

  it('are not started again after a restart of the daemon', async () => {
    const h = await start(`  actions:
    push: { run: "echo run >> ${'$'}AIP_REPOSITORY/../count; while [ ! -f ${'$'}AIP_REPOSITORY/../go ]; do sleep 0.02; done" }
  stages:
    after_delivery: [push]`);
    h.script({ code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }] });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'running');
    await until('the count', () => existsSync(join(h.repo, '..', 'count')));
    await h.restart();
    const view = await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    expect(view.system[0]?.reason).toBe('interrupted');
    writeFileSync(join(h.repo, '..', 'go'), '');
    await h.call('retry', { runId, group: '_action-after-delivery-push' });
    await h.waitFor(runId, (run) => run.system[0]?.status === 'done');
    expect(
      readFileSync(join(h.repo, '..', 'count'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(2);
  });
});

describe('specialist actions', () => {
  it('work in the tree of the run after the split and hand their changes to the groups', async () => {
    const h = await start(`  actions:
    notes: { specialist: coder, additional_prompt: Write notes }
  stages:
    after_split: [notes]
  delivery: { auto: false }`);
    h.script({ ...SPLIT_TWO, notes: [{ write: { 'notes.md': 'notes\n' } }], code: [{}, {}] });
    const created = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'сделать',
    })) as RunCreated;
    const view = await h.waitFor(created.runId, (run) => run.finished);
    expect(system(view)).toEqual(['split:::done', 'action:after_split:notes:done']);
    const slug = view.groups[0]?.slug ?? '';
    const files = git(h.repo, 'ls-tree', '--name-only', `refs/aip/${created.runId}/groups/${slug}`);
    expect(files.split('\n')).toContain('notes.md');
  });

  it('drop their changes before delivery', async () => {
    const h = await start(`  actions:
    review: { specialist: coder }
  stages:
    before_delivery: [review]`);
    h.script({
      code: [{ write: { 'lib.ts': 'export const value = 2;\n' } }],
      review: [{ write: { 'lib.ts': 'junk\n', 'extra.ts': 'junk\n' } }],
    });
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(readFileSync(join(h.repo, 'lib.ts'), 'utf8')).toBe('export const value = 2;\n');
    expect(existsSync(join(h.repo, 'extra.ts'))).toBe(false);
  });
});

describe('command actions', () => {
  it('stop at the timeout with the reason timeout', async () => {
    const h = await start(`  actions:
    slow: { run: "sleep 30", timeout: 1 }
  stages:
    before_delivery: [slow]
  delivery: { auto: false }`);
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('apply', { runId });
    const view = await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    expect(view.system[0]?.reason).toBe('timeout');
  });

  it('keep the output in the log of the attempt and the exit code in the reason', async () => {
    const h = await start(`  actions:
    check: { run: "echo hello from the check; echo oops >&2; exit 1" }
  stages:
    before_delivery: [check]
  delivery: { auto: false }`);
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.finished);
    await h.call('apply', { runId });
    await h.waitFor(runId, (run) => run.system[0]?.status === 'failed');
    const group = await h.group(runId, '_action-before-delivery-check');
    expect(group.log?.lines.join('\n')).toContain('hello from the check');
    expect(group.log?.lines.join('\n')).toContain('oops');
    expect(group.attempts[0]).toMatchObject({ runtime: 'command', reason: 'exit code 1' });
  });

  it('get the environment of the run', async () => {
    const h = await start(`  actions:
    env: { run: "printf '%s|%s|%s|%s' \\"$AIP_RUN_ID\\" \\"$AIP_PIPELINE\\" \\"$AIP_STAGE\\" \\"$AIP_ACTION\\" > $AIP_REPOSITORY/../env; printf %s \\"$AIP_WORKFLOW\\" > $AIP_REPOSITORY/../env-old" }
  stages:
    before_delivery: [env]`);
    const runId = await plainRun(h);
    await h.waitFor(runId, (run) => run.system[0]?.status === 'done');
    expect(readFileSync(join(h.repo, '..', 'env'), 'utf8')).toBe(
      `${runId}|plain|before_delivery|env`,
    );
    expect(readFileSync(join(h.repo, '..', 'env-old'), 'utf8')).toBe('plain');
  });
});

describe('the stages of the pipeline', () => {
  it('list the actions in the topology of the pipeline and of the run', async () => {
    const h = await start(`  actions:
    prepare: { run: "true" }
    commit: { run: "true" }
  stages:
    before_split: [prepare]
    after_delivery: [commit]
  delivery: { auto: false }`);
    const view = (await h.call('pipelines', { repository: h.repo })) as PipelinesView;
    const feature = view.pipelines.find((pipeline) => pipeline.id === 'feature');
    expect(feature?.stages.map((stage) => stage.id)).toEqual([
      'action:before_split:prepare',
      'split',
      'step:code',
      'merge',
      'delivery',
      'action:after_delivery:commit',
      'cleanup',
    ]);
    const plain = view.pipelines.find((pipeline) => pipeline.id === 'plain');
    expect(plain?.stages.map((stage) => stage.id)).toEqual([
      'step:code',
      'merge',
      'delivery',
      'action:after_delivery:commit',
      'cleanup',
    ]);
    const runId = await plainRun(h);
    const run = await h.waitFor(runId, (state) => state.finished);
    const commit = run.topology.stages.find((stage) => stage.id === 'action:after_delivery:commit');
    expect(commit).toMatchObject({ status: null, group: null });
  });

  it('answer the request system_stages with the tasks and the levels of the settings', async () => {
    const h = await start(
      `  delivery: { resolver: coder, resolver_prompt: Всегда сохраняй правки }`,
    );
    const view = (await h.call('system_stages', { repository: h.repo })) as SystemStagesView;
    expect(view.errors).toEqual([]);
    expect(view.stages.map((stage) => stage.kind)).toEqual([
      'split',
      'message',
      'delivery',
      'resolve',
    ]);
    const resolver = view.stages.find((stage) => stage.kind === 'resolve');
    expect(resolver?.task).toContain('conflict markers');
    expect(resolver?.performer).toMatchObject({ type: 'specialist', slug: 'coder' });
    expect(resolver?.settings).toContainEqual({
      path: 'delivery.resolver_prompt',
      value: 'Всегда сохраняй правки',
      level: 'project',
    });
    expect(resolver?.settings).toContainEqual({
      path: 'delivery.resolver_rounds',
      value: 1,
      level: 'default',
    });
  });

  it('keeps the work groups apart from the groups of the actions', async () => {
    const h = await start(`  actions:
    check: { run: "true" }
  stages:
    before_delivery: [check]`);
    const runId = await plainRun(h);
    const view = await h.waitFor(runId, (run) => run.deliveryStage?.status === 'applied');
    expect(view.groups).toHaveLength(1);
    expect(view.counts).toBe('merged 1');
    expect(view.total).toBe(1);
    expect((await h.status(runId)).groups).toHaveLength(1);
  });
});
