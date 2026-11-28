import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApplication, startDaemon, type RunningDaemon } from '../../src/app/index.ts';
import { RunRepository } from '../../src/feature/runs/repositories/index.ts';
import { ProbeAdmissionRepository } from '../../src/feature/runs/repositories/index.ts';
import { PROBE_LIMITS } from '../../src/feature/runs/types/index.ts';
import type { Attempt } from '../../src/feature/runs/types/index.ts';
import type { ProbeView, RunCreated, RunView } from '../../src/presentation/ipc/contract/index.ts';
import { request } from '../../src/presentation/ipc/client/index.ts';
import { socketPath } from '../../src/platform/paths/index.ts';
import { run as seedRun } from '../feature/runs/helpers.ts';
import { TEST_TIMINGS, git, harness, settle, startRun, until, type Harness } from './harness.ts';

/** A pipeline with two variants of the code step: the candidates of a contrast experiment. */
const VARIANTS_CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Coder }
    reviewer: { name: Reviewer, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }
      variants:
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

function fakeLines(h: Harness, file: string): Record<string, any>[] {
  const path = join(h.fakeState, file);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, any>);
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    seq: 1,
    stepId: 'code',
    stepIndex: 0,
    round: 1,
    specialist: 'coder',
    runtime: 'claude',
    model: 'sonnet',
    generation: null,
    status: 'finished',
    input: {
      prompt: 'do it',
      groupTitle: 'Group 1',
      stepId: 'code',
      specialistName: 'Coder',
      skills: [],
      previous: [],
      feedback: null,
      humanAnswer: null,
      decisions: [],
    },
    resumeSession: null,
    sessionId: null,
    report: { verdict: 'done', summary: 'done', feedback: null },
    reason: null,
    startedAt: 10,
    finishedAt: 20,
    usage: null,
    proposal: null,
    denials: [],
    outsideChanges: [],
    ...overrides,
  };
}

/** A finished run of the repository whose coder had a denied tool call: a lesson for later runs. */
function seedLesson(h: Harness): void {
  const state = seedRun(1, { id: 'seeded-lessons-run' });
  state.run.repository = h.repo;
  state.run.number = 7;
  state.run.finishedAt = Date.now();
  state.groups[0]!.attempts.push(
    attempt({
      denials: [{ tool: 'Bash', command: 'rm -rf build' }],
      outsideChanges: ['/tmp/a.ts'],
    }),
  );
  new RunRepository(h.running.application.database).saveRun(state);
}

/** A pipeline whose variant leaves out a step: a probe must copy the resolved configuration. */
const VARIANT_CONFIG = `swarm:
  max: 3
  specialists:
    coder: { name: Coder }
    reviewer: { name: Reviewer, permissions: read }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
        - { id: review, specialist: reviewer, on_reject: { goto: code, max_rounds: 2 } }
      variants:
        light:
          skip: [review]
`;

/** A pipeline whose variant changes the specialist of a step: a switch edits the step in place. */
const SHARED_CONFIG = `swarm:
  max: 1
  specialists:
    coder: { name: Coder, runtime: claude, model: sonnet }
    deep: { name: Deep, runtime: claude, model: opus }
  pipelines:
    feature:
      steps:
        - { id: code, specialist: coder }
      variants:
        deep:
          steps:
            code: { specialist: deep }
`;

describe('probes of another harness', () => {
  it('probes a run whose variant leaves out a step', async () => {
    const h = await harness(VARIANT_CONFIG);
    current = h;
    h.script({
      code: [
        { write: { 'base-variant.txt': 'base\n' }, waitFor: h.gate('variant') },
        { write: { 'probe-variant.txt': 'probe\n' } },
      ],
    });
    const base = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'leave out the review',
      variant: 'light',
    });
    const probe = (await h.call('run_probe', { runId: base.runId })) as RunCreated;
    expect(probe.probeOf).toBe(base.runId);
    expect(probe.harness).toBe('none');

    const baseView = await h.status(base.runId);
    const probeView = await h.status(probe.runId);
    expect(probeView.variant).toBe('light');
    expect(baseView.steps.map((step) => step.id)).toEqual(['code']);
    expect(probeView.steps.map((step) => step.id)).toEqual(baseView.steps.map((step) => step.id));

    h.open('variant');
    await h.waitFor(base.runId, (view) => view.finished);
    await h.waitFor(probe.runId, (view) => view.finished);
    expect((await h.status(probe.runId)).deliveryStage).toEqual({ status: 'pending' });
  }, 60_000);

  it('keeps the configuration of a live base run when a probe switches its variant', async () => {
    const h = await harness(SHARED_CONFIG);
    current = h;
    h.script({
      code: [
        { write: { 'base-shared.txt': 'base\n' }, waitFor: h.gate('shared') },
        { write: { 'probe-shared.txt': 'probe\n' } },
      ],
    });
    const base = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'change one step',
    });
    await until('the base agent to start', () => existsSync(join(h.fakeState, 'calls.jsonl')));
    const probe = (await h.call('run_probe', { runId: base.runId })) as RunCreated;
    const stepOf = async (id: string) => (await h.status(id)).steps[0]!;
    expect(await stepOf(base.runId)).toMatchObject({ id: 'code', specialist: 'coder' });

    // The probe follows another variant while the base is alive: only the probe changes.
    await h.call('run_variant', { runId: probe.runId, variant: 'deep' });
    expect(await stepOf(probe.runId)).toMatchObject({ id: 'code', specialist: 'deep' });
    expect(await stepOf(base.runId)).toMatchObject({ id: 'code', specialist: 'coder' });

    h.open('shared');
    await h.waitFor(base.runId, (view) => view.finished);
    await h.waitFor(probe.runId, (view) => view.finished);
    const models = fakeLines(h, 'calls.jsonl')
      .filter((call) => call.step === 'code')
      .map((call) => call.args[call.args.indexOf('--model') + 1]);
    expect(models.slice(0, 2)).toEqual(['sonnet', 'opus']);
    expect((await h.status(probe.runId)).deliveryStage).toEqual({ status: 'pending' });
  }, 60_000);

  it('runs two probes of one task in their own trees and never delivers them', async () => {
    const h = await harness();
    current = h;
    seedLesson(h);
    h.script({
      code: [
        { write: { 'base.txt': 'base\n' }, waitFor: h.gate('base') },
        { write: { 'probe-one.txt': 'one\n' } },
        { write: { 'probe-two.txt': 'two\n' } },
      ],
    });
    const base = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'add it' });
    const slug = base.groups[0]!.slug;
    const title = base.groups[0]!.title;
    // The attempts of all three runs share the script of the group and the step: the counter tells
    // the fake agent which entry to take, and the base must take the first one before a probe starts.
    const counter = join(h.fakeState, `count-${title.replace(/[^\w.-]/g, '_')}-code`);
    const taken = (): number => (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0);
    await until('the base agent to start', () => taken() >= 1);

    const first = (await h.call('run_probe', { runId: base.runId })) as RunCreated;
    expect(first.probeOf).toBe(base.runId);
    expect(first.harness).toBe('none');
    expect(first.number).toBe(base.number);
    await until('the first probe to start', () => taken() >= 2);
    const second = (await h.call('run_probe', {
      runId: base.runId,
      harness: 'none',
    })) as RunCreated;
    await until('the second probe to start', () => taken() >= 3);
    await expect(h.call('run_probe', { runId: base.runId, harness: 'full' })).rejects.toThrow(
      /harness/,
    );

    const probes = [first.runId, second.runId];
    for (const id of probes) await h.waitFor(id, (view) => view.finished);
    await settle(h);

    // No probe reached the working tree: its merged groups wait for an explicit apply.
    for (const id of probes) {
      const view = await h.status(id);
      expect(view.harness).toBe('none');
      expect(view.probeOf).toBe(base.runId);
      expect(view.groups[0]?.delivery).toBe('pending');
      expect(view.deliveryStage).toEqual({ status: 'pending' });
    }

    // The input of every probe repeats the input of the base run; only the harness differs.
    const states = h.running.application.services.runs.states;
    const inputOf = (id: string) =>
      states.get(id).groups[0]!.attempts.find((one) => one.stepId === 'code')!.input;
    expect(inputOf(first.runId)).toEqual(inputOf(base.runId));
    expect(inputOf(second.runId)).toEqual(inputOf(base.runId));

    // Every run has its own worktree and its own refs, and none of them is a visible branch.
    const ids = [base.runId, ...probes];
    const details = await Promise.all(ids.map((id) => h.group(id, slug)));
    const worktrees = details.map((detail) => detail.worktree);
    expect(new Set(worktrees).size).toBe(3);
    ids.forEach((id, index) => {
      expect(details[index]!.worktree.startsWith(join(h.repo, '.aip', 'worktrees', id))).toBe(true);
    });
    const refs = git(h.repo, 'for-each-ref', '--format=%(refname)', 'refs/aip/').split('\n');
    for (const id of ids) {
      expect(refs).toContain(`refs/aip/${id}/run`);
      expect(refs).toContain(`refs/aip/${id}/groups/${slug}`);
    }
    const commits = ids.map((id) => git(h.repo, 'rev-parse', `refs/aip/${id}/groups/${slug}`));
    expect(new Set(commits).size).toBe(3);
    expect(git(h.repo, 'branch', '--list', 'aip/*')).toBe('');

    // The full harness teaches the base with the lessons of the seeded run; a probe's `none` does not.
    const skill = (id: string, seq: number): string =>
      join(
        h.repo,
        '.aip',
        'logs',
        id,
        slug,
        String(seq),
        'skills',
        '.claude',
        'skills',
        'aip-lessons',
        'SKILL.md',
      );
    const baseCode = (await h.group(base.runId, slug)).attempts.find(
      (one) => one.stepId === 'code',
    )!;
    expect(existsSync(skill(base.runId, baseCode.seq))).toBe(true);
    const probeCode = (await h.group(first.runId, slug)).attempts.find(
      (one) => one.stepId === 'code',
    )!;
    expect(existsSync(skill(first.runId, probeCode.seq))).toBe(false);
    const calls = fakeLines(h, 'calls.jsonl');
    const codeCall = (id: string): Record<string, any> =>
      calls.find((call) => call.step === 'code' && String(call.cwd).includes(id))!;
    const promptOf = (id: string): string =>
      String(codeCall(id).args[codeCall(id).args.indexOf('--append-system-prompt') + 1]);
    expect(promptOf(base.runId)).toContain('aip-lessons');
    expect(promptOf(first.runId)).not.toContain('aip-lessons');

    // The main run delivers into the working tree as before; the probes stay where they are.
    h.open('base');
    const delivered = await h.waitFor(base.runId, (view: RunView) => view.delivery.applied === 1);
    expect(delivered.deliveryStage).toEqual({ status: 'applied', manual: false });
    expect(existsSync(join(h.repo, 'base.txt'))).toBe(true);
    expect(existsSync(join(h.repo, 'probe-one.txt'))).toBe(false);
    expect(existsSync(join(h.repo, 'probe-two.txt'))).toBe(false);
    for (const id of probes)
      expect((await h.status(id)).deliveryStage).toEqual({ status: 'pending' });
  }, 60_000);

  it('takes the places of the task by the shared key and refuses both exhausted areas', async () => {
    const h = await harness(VARIANTS_CONFIG);
    current = h;
    h.script({
      'code@Login@default': [{ write: { 'source.ts': 'source\n' } }],
      'code@Login@sonnet': [{ write: { 'probe-base.ts': 'base\n' } }],
      'code@Login@opus': [{ write: { 'probe-strong.ts': 'strong\n' } }],
    });
    const source = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'budget' }],
      autoDeliver: false,
    });
    await h.waitFor(source.runId, (view) => view.finished);

    // The plan of the experiment takes its places first: two candidates of one repetition.
    const contrast = (await h.call('run_contrast', {
      runId: source.runId,
      candidates: ['base', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    })) as ProbeView;
    await Promise.all(
      contrast.experiment.runs.map((run) => h.waitFor(run.runId, (view) => view.finished)),
    );

    const db = h.running.application.database;
    const rows = () =>
      db
        .prepare('SELECT id, root_run_id AS root, runs FROM probe_admissions ORDER BY id')
        .all() as { id: string; root: string; runs: number }[];
    // The plan and a single probe share the key of the source task: the source run itself.
    expect(rows()).toEqual([{ id: contrast.experiment.id, root: source.runId, runs: 2 }]);
    await until('the experiment to settle', async () => {
      const shown = (await h.call('contrast_show', { id: contrast.experiment.id })) as ProbeView;
      return shown.status === 'ready';
    });
    const experimentBefore = (await h.call('contrast_show', {
      id: contrast.experiment.id,
    })) as ProbeView;
    const admissions = new ProbeAdmissionRepository(db, PROBE_LIMITS);
    const fillers = (prefix: string, count: number, runs: number, root?: string) => {
      for (let index = 0; index < count; index += 1) {
        admissions.restore({
          id: `${prefix}-${index}`,
          rootRunId: root ?? `other-${prefix}`,
          runs,
          now: Date.now(),
        });
      }
    };
    const snapshot = () => ({
      refs: git(h.repo, 'for-each-ref', '--format=%(refname)', 'refs/aip/').split('\n').sort(),
      admissions: rows(),
      runs: (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n,
      queue: (db.prepare('SELECT COUNT(*) AS n FROM queue_items').get() as { n: number }).n,
    });

    // The window of 24 hours holds 24 places: 2 of the experiment and 24 of other tasks.
    fillers('window', 2, 12);
    const filled = snapshot();
    await expect(h.call('run_probe', { runId: source.runId })).rejects.toThrow(
      'the probe budget of the 24h window is exhausted: limit 24, used 26, requested 1',
    );
    expect(snapshot()).toEqual(filled);
    db.prepare("DELETE FROM probe_admissions WHERE id LIKE 'window-%'").run();

    // The task itself has spent its 12 places: the refusal writes nothing again.
    fillers('task', 10, 1, source.runId);
    const taskFilled = snapshot();
    await expect(h.call('run_probe', { runId: source.runId })).rejects.toThrow(
      'the probe budget of the task is exhausted: limit 12, used 12, requested 1',
    );
    expect(snapshot()).toEqual(taskFilled);
    db.prepare("DELETE FROM probe_admissions WHERE id LIKE 'task-%'").run();

    // With the places free the probe is admitted: one more place of the same task.
    const free = snapshot();
    const admitted = (await h.call('run_probe', { runId: source.runId })) as RunCreated;
    expect(admitted.probeOf).toBe(source.runId);
    await h.waitFor(admitted.runId, (view) => view.finished);
    const after = snapshot();
    const added = after.refs.filter((ref) => !free.refs.includes(ref));
    expect(added.sort()).toEqual([
      `refs/aip/${admitted.runId}/groups/login`,
      `refs/aip/${admitted.runId}/run`,
    ]);
    expect(after.runs).toBe(free.runs + 1);
    expect(after.queue).toBe(free.queue);
    const mine = after.admissions.filter((row) => row.root === source.runId);
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((row) => row.id))).toEqual(
      new Set([contrast.experiment.id, admitted.runId]),
    );
    expect(mine.map((row) => row.runs).sort()).toEqual([1, 2]);

    // The stored experiment survived the refusals untouched.
    const experimentAfter = (await h.call('contrast_show', {
      id: contrast.experiment.id,
    })) as ProbeView;
    expect(experimentAfter.experiment).toEqual(experimentBefore.experiment);
  }, 60_000);

  it('refuses a contrast experiment over the budget and leaves nothing behind', async () => {
    const h = await harness(VARIANTS_CONFIG);
    current = h;
    h.script({ 'code@Login@base': [{ write: { 'source.ts': 'source\n' } }] });
    const source = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      groups: [{ title: 'Login', task: 'budget' }],
      autoDeliver: false,
    });
    await h.waitFor(source.runId, (view) => view.finished);

    const db = h.running.application.database;
    const admissions = new ProbeAdmissionRepository(db, PROBE_LIMITS);
    const rows = () =>
      db
        .prepare('SELECT id, root_run_id AS root, runs FROM probe_admissions ORDER BY id')
        .all() as { id: string; root: string; runs: number }[];
    const probeFiles = (): string[] => {
      try {
        return readdirSync(join(h.state, 'probes')).sort();
      } catch {
        return [];
      }
    };
    const snapshot = () => ({
      refs: git(h.repo, 'for-each-ref', '--format=%(refname)', 'refs/aip/').split('\n').sort(),
      runs: (db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n,
      queue: (db.prepare('SELECT COUNT(*) AS n FROM queue_items').get() as { n: number }).n,
      admissions: rows(),
      probes: probeFiles(),
    });

    // The task has eleven of its twelve places taken: a plan of two does not fit.
    for (let index = 0; index < 11; index += 1) {
      admissions.restore({
        id: `earlier-${index}`,
        rootRunId: source.runId,
        runs: 1,
        now: Date.now(),
      });
    }
    const filled = snapshot();
    await expect(
      h.call('run_contrast', {
        runId: source.runId,
        candidates: ['base', 'strong'],
        repetitions: 1,
        maxRuns: 2,
      }),
    ).rejects.toThrow('the probe budget of the task is exhausted: limit 12, used 11, requested 2');
    expect(snapshot()).toEqual(filled);

    // The task places are free again, but 24 places of other tasks fill the window of 24 hours.
    db.prepare("DELETE FROM probe_admissions WHERE id LIKE 'earlier-%'").run();
    for (let index = 0; index < 24; index += 1) {
      admissions.restore({
        id: `window-${index}`,
        rootRunId: `window-${index}`,
        runs: 1,
        now: Date.now(),
      });
    }
    const windowFilled = snapshot();
    await expect(
      h.call('run_contrast', {
        runId: source.runId,
        candidates: ['base', 'strong'],
        repetitions: 1,
        maxRuns: 2,
      }),
    ).rejects.toThrow(
      'the probe budget of the 24h window is exhausted: limit 24, used 24, requested 2',
    );
    expect(snapshot()).toEqual(windowFilled);

    // Nothing was created by either refusal: no experiment carries a fresh id.
    await expect(h.call('contrast_show', { id: 'prnone' })).rejects.toThrow(
      /unknown probe experiment/,
    );
  }, 60_000);

  it('restores the plan of an older experiment before the first request of a new daemon', async () => {
    const h = await harness();
    current = h;
    h.script({ code: [{ write: { 'source.txt': 'source\n' } }] });
    const source = await startRun(h, {
      repository: h.repo,
      pipeline: 'feature',
      task: 'budget',
      autoDeliver: false,
    });
    await h.waitFor(source.runId, (view) => view.finished);
    const socket = h.running.application.socket;
    const { environment, repo, state } = h;
    await h.close();
    current = null;

    // The upgrade adds the table of admissions: it knows none of the places the plans before it
    // took. The store keeps such a plan, an experiment of twelve runs with none created yet.
    mkdirSync(join(state, 'probes'), { recursive: true });
    writeFileSync(
      join(state, 'probes', 'oldplan.json'),
      JSON.stringify({
        id: 'oldplan',
        repository: repo,
        sourceRun: source.runId,
        sourceGroup: source.groups[0]!.slug,
        groupTitle: source.groups[0]!.title,
        split: false,
        pipeline: 'feature',
        task: 'budget',
        baseCommit: 'base',
        provider: null,
        skip: [],
        candidates: ['default', 'strong'],
        repetitions: 6,
        budget: { maxRuns: 12, maxTokens: null },
        planned: 12,
        stopped: null,
        stopReason: null,
        runs: [],
        createdAt: Date.now(),
        proposalPath: null,
      }),
    );

    // The restore is the first synchronous step of the start: the table of admissions already
    // holds the plan before the start waits for anything, so no request the socket serves can
    // be admitted ahead of the places the plan took.
    const application = createApplication({
      stateDirectory: state,
      entry: [process.execPath, join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')],
      environment,
      timings: TEST_TIMINGS,
    });
    const starting = application.start();
    try {
      const restored = application.database
        .prepare('SELECT id, root_run_id AS root, runs FROM probe_admissions')
        .get() as { id: string; root: string; runs: number } | undefined;
      expect(restored).toEqual({ id: 'oldplan', root: source.runId, runs: 12 });
      await starting;
    } finally {
      await application.stop();
    }

    // The daemon is asked while it is still starting: the socket exists from the listen on, and
    // the request below is written the moment it does, so the daemon handles it while its start
    // block still runs. The refusal must not wait for the end of the start, or the first probe
    // would slip past the budget of its task.
    const pendingDaemon = startDaemon({
      stateDirectory: state,
      entry: [process.execPath, join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts')],
      environment,
      timings: TEST_TIMINGS,
    });
    let daemon: RunningDaemon | null = null;
    try {
      const deadline = Date.now() + 10_000;
      while (!existsSync(socket)) {
        if (Date.now() > deadline) throw new Error('timed out waiting for the socket to appear');
      }
      await expect(request(socket, 'run_probe', { runId: source.runId })).rejects.toThrow(
        'the probe budget of the task is exhausted: limit 12, used 12, requested 1',
      );
      daemon = await pendingDaemon;
      const admissions = daemon.application.database
        .prepare('SELECT id, root_run_id AS root, runs FROM probe_admissions')
        .all() as { id: string; root: string; runs: number }[];
      expect(admissions).toEqual([{ id: 'oldplan', root: source.runId, runs: 12 }]);
      expect(daemon.application.services.runs.states.lookup(source.runId)).toBeDefined();
    } finally {
      daemon ??= await pendingDaemon;
      await daemon.close();
    }
  }, 60_000);
});
