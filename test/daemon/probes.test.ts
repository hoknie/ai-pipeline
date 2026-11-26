import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProbeView, RunCreated, RunView } from '../../src/presentation/ipc/contract/index.ts';

import { PIPELINE_CONFIG, git, harness, startRun, until, type Harness } from './harness.ts';

const CONFIG = `${PIPELINE_CONFIG}      variants:
        base:
          name: Base
          steps:
            code: { model: sonnet }
        strong:
          name: Strong
          steps:
            code: { model: opus }
`;

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

async function start(config = CONFIG): Promise<Harness> {
  current = await harness(config);
  return current;
}

function branchOf(runId: string): string {
  return `refs/aip/${runId}/run`;
}

async function probe(
  h: Harness,
  runId: string,
  candidates: string[],
  repetitions = 1,
  maxTokens?: number,
): Promise<ProbeView> {
  return (await h.call('run_contrast', {
    runId,
    candidates,
    repetitions,
    maxRuns: candidates.length * repetitions,
    ...(maxTokens === undefined ? {} : { maxTokens }),
  })) as ProbeView;
}

function finished(h: Harness, runId: string): Promise<RunView> {
  return h.waitFor(runId, (view) => view.finished);
}

interface Call {
  step: string;
  group: string;
  model: string;
  prompt: string;
  message: string;
}

/** Every call the fake agents made, in order: the same records a test reads the input from. */
function calls(h: Harness): Call[] {
  return readFileSync(join(h.fakeState, 'calls.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Call);
}

describe('contrast probes of a run', () => {
  it('runs two variants of one task from one base in their own refs, without delivering', async () => {
    const h = await start();
    h.script({
      'code@Login': [{ write: { 'source.ts': 'source\n' } }],
      'code@Login@sonnet': [{ write: { 'probe-base.ts': 'base\n' } }],
      'code@Login@opus': [{ write: { 'probe-strong.ts': 'strong\n' } }],
    });
    const source = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'add login' }],
      autoDeliver: false,
    })) as RunCreated;
    const first = await finished(h, source.runId);
    expect(first.groups.map((group) => group.status)).toEqual(['merged']);

    const started = await probe(h, source.runId, ['base', 'strong']);
    expect(started.experiment).toMatchObject({
      sourceRun: source.runId,
      sourceGroup: 'login',
      groupTitle: 'Login',
      split: false,
      pipeline: 'feature',
      task: 'add login',
      baseCommit: first.baseCommit,
      candidates: ['base', 'strong'],
      planned: 2,
      stopped: null,
    });
    const probes = started.experiment.runs;
    expect(probes).toHaveLength(2);
    expect(new Set(probes.map((run) => run.runId)).size).toBe(2);
    for (const run of probes) expect(run.runId).not.toBe(source.runId);

    const final = await Promise.all(probes.map((run) => finished(h, run.runId)));
    const sourceGroup = await h.group(source.runId, 'login');
    const names = [branchOf(source.runId), ...probes.map((run) => branchOf(run.runId))];
    for (const name of names) {
      expect(git(h.repo, 'rev-parse', '--verify', name)).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(new Set(names).size).toBe(3);
    const userTree = git(h.repo, 'status', '--porcelain');
    expect(userTree).toBe('');
    expect(git(h.repo, 'branch', '--show-current')).toBe('main');

    for (const [index, run] of probes.entries()) {
      const view = final[index] as RunView;
      expect(view).toMatchObject({
        fromQueue: false,
        queueItem: null,
        autoDeliver: false,
        variant: run.candidate,
        baseCommit: first.baseCommit,
      });
      expect(view.delivery).toMatchObject({ applied: 0, merged: 1, failed: 0 });
      expect(view.deliveryStage).toMatchObject({ status: 'pending' });
      // The probe keeps the title of the source group, so every step gets the source's step input.
      const detail = await h.group(run.runId, 'login');
      expect(detail.worktree).not.toBe(sourceGroup.worktree);
      expect(existsSync(join(detail.worktree, `probe-${run.candidate}.ts`))).toBe(true);
      expect(existsSync(join(detail.worktree, 'source.ts'))).toBe(false);
      expect(existsSync(join(sourceGroup.worktree, `probe-${run.candidate}.ts`))).toBe(false);
    }
    expect(readFileSync(join(sourceGroup.worktree, 'source.ts'), 'utf8')).toBe('source\n');
    for (const file of ['probe-base.ts', 'probe-strong.ts']) {
      expect(existsSync(join(h.repo, file))).toBe(false);
    }

    // Only the harness changes between the probes: the step input of the code step is one and the
    // same for the source and both probes, while the model differs with the variant.
    const login = calls(h).filter((call) => call.step === 'code' && call.group === 'Login');
    expect(login.map((call) => call.model).sort()).toEqual(['default', 'opus', 'sonnet']);
    expect(new Set(login.map((call) => call.prompt)).size).toBe(1);
    expect(new Set(login.map((call) => call.message)).size).toBe(1);
  });

  it('compares the probes of one input by the objective signal of their runs', async () => {
    const h = await start();
    h.script({
      'code@Login': [{ write: { 'source.ts': 'source\n' } }],
      'code@Login@sonnet': [{ write: { 'probe-base.ts': 'base\n' } }],
      'code@Login@opus': [{ write: { 'probe-strong.ts': 'strong\n' } }],
    });
    const source = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'add login' }],
      autoDeliver: false,
    })) as RunCreated;
    const first = await finished(h, source.runId);
    const started = await probe(h, source.runId, ['base', 'strong']);
    await Promise.all(started.experiment.runs.map((run) => finished(h, run.runId)));
    const shown = (await h.call('contrast_show', { id: started.experiment.id })) as ProbeView;
    expect(shown.status).toBe('ready');
    expect(shown.comparison.observations).toHaveLength(2);
    expect(shown.comparison.observations.every((entry) => entry.clean)).toBe(true);
    expect(shown.comparison.scores.map((score) => score.clean)).toEqual([1, 1]);
    expect(shown.comparison.versus[0]).toMatchObject({ pairs: 1, ties: 1, significant: false });
    expect(shown.comparison.winner).toBeNull();
    expect(shown.proposalPath).not.toBeNull();
    const proposal = readFileSync(shown.proposalPath!, 'utf8');
    expect(proposal).toContain('no change');
    for (const run of started.experiment.runs) expect(proposal).toContain(run.runId);
    // The proposal of a finished experiment is only text: nothing is applied or delivered.
    await h.call('contrast_show', { id: started.experiment.id });
    expect(git(h.repo, 'status', '--porcelain')).toBe('');
    expect(first.delivery.applied).toBe(0);
  });

  it('stops before the next repetition when the probes reached the token budget', async () => {
    const h = await start();
    const usage = [{ input: 10, output: 0 }];
    h.script({
      'code@Login': [{ write: { 'source.ts': 'source\n' } }],
      'code@Login@sonnet': [{ usage, write: { 'probe-base.ts': 'base\n' } }],
      'code@Login@opus': [{ usage, write: { 'probe-strong.ts': 'strong\n' } }],
    });
    const source = (await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'add login' }],
      autoDeliver: false,
    })) as RunCreated;
    await finished(h, source.runId);
    const started = await probe(h, source.runId, ['base', 'strong'], 3, 20);
    expect(started.experiment.runs).toHaveLength(2);
    await Promise.all(started.experiment.runs.map((run) => finished(h, run.runId)));
    let shown: ProbeView | null = null;
    await until('the token budget stops the experiment', async () => {
      shown = (await h.call('contrast_show', { id: started.experiment.id })) as ProbeView;
      return shown.experiment.stopped === 'tokens';
    });
    expect(shown!.experiment.runs).toHaveLength(2);
    expect(shown!.status).toBe('budget_exhausted');
    expect(shown!.experiment.stopReason).toBeNull();
    expect(shown!.comparison.winner).toBeNull();
  }, 30_000);
});
