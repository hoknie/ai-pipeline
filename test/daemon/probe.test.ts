import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RunRepository } from '../../src/feature/runs/repositories/index.ts';
import type { Attempt } from '../../src/feature/runs/types/index.ts';
import type { RunCreated, RunView } from '../../src/presentation/ipc/contract/index.ts';
import { run as seedRun } from '../feature/runs/helpers.ts';
import { git, harness, settle, startRun, until, type Harness } from './harness.ts';

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
});
