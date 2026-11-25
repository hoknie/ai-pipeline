import { describe, expect, it } from 'vitest';

import { RunProbes } from '../../../src/feature/runs/services/index.ts';
import {
  MIN_DECIDING_PAIRS,
  type ProbeCheck,
  type ProbeExperiment,
  type ProbeLauncher,
  type ProbeQueue,
  type ProbeRunRequest,
  type ProbeStates,
  type ProbeStore,
  type RunCreated,
  type RunState,
} from '../../../src/feature/runs/types/index.ts';
import type { ConfigService } from '../../../src/feature/swarm-config/services/index.ts';

import { CONFIG_TEXT, config as parse, group, run } from './helpers.ts';

const CONFIGURED_TEXT = `${CONFIG_TEXT.replace(
  'swarm:\n',
  'swarm:\n  providers:\n    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }\n',
)}      variants:\n        strong: {}\n`;

const ATTACHMENT = { id: 'a1', fileName: 'task.md', size: 4, mediaType: 'text/markdown' };

class MemoryStore implements ProbeStore {
  readonly experiments = new Map<string, ProbeExperiment>();
  readonly proposals = new Map<string, string>();

  save(experiment: ProbeExperiment): void {
    this.experiments.set(experiment.id, experiment);
  }

  load(id: string): ProbeExperiment | null {
    return this.experiments.get(id) ?? null;
  }

  list(): ProbeExperiment[] {
    return [...this.experiments.values()];
  }

  writeProposal(id: string, markdown: string): string {
    this.proposals.set(id, markdown);
    return `/state/probes/${id}.md`;
  }
}

class FakeStates implements ProbeStates {
  readonly states = new Map<string, RunState>();

  lookup(id: string): RunState | undefined {
    return this.states.get(id);
  }
}

/** The serial queue of the daemon, without the scheduler: the probes' work runs in order. */
class FakeQueue implements ProbeQueue {
  stopping = false;
  private chain: Promise<unknown> = Promise.resolve();

  serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

interface LauncherOptions {
  /** The request number that fails, counting from one. */
  failAt?: number;
  /** Tokens every created probe spends; its state is finished at once. */
  tokens?: number;
}

class FakeLauncher implements ProbeLauncher {
  readonly requests: ProbeRunRequest[] = [];
  readonly created: string[] = [];
  readonly states: FakeStates | null;
  readonly failAt: number | null;
  readonly tokens: number;
  private next = 0;

  constructor(states: FakeStates | null = null, options: LauncherOptions = {}) {
    this.states = states;
    this.failAt = options.failAt ?? null;
    this.tokens = options.tokens ?? 0;
  }

  async createProbe(request: ProbeRunRequest): Promise<RunCreated> {
    this.requests.push(request);
    if (this.failAt !== null && this.requests.length === this.failAt) {
      throw new Error('the launcher failed');
    }
    this.next += 1;
    const runId = `probe-${request.variant}-${this.next}`;
    this.created.push(runId);
    if (this.states !== null && this.tokens > 0) {
      const state = run(1, { id: runId });
      const work = group(state);
      work.status = 'merged';
      work.mergeCommit = 'merge';
      work.attempts.push({
        usage: { inputTokens: this.tokens, outputTokens: 0 },
      } as unknown as (typeof work.attempts)[number]);
      this.states.states.set(runId, state);
    }
    return {
      runId,
      number: request.number,
      branch: `refs/aip/${runId}/run`,
      groups: [],
      split: true,
      warnings: [],
      harness: 'full',
      probeOf: null,
    };
  }
}

function setup(launcherOptions: LauncherOptions = {}, check?: ProbeCheck) {
  const store = new MemoryStore();
  const states = new FakeStates();
  const launcher = new FakeLauncher(states, launcherOptions);
  const engine = new FakeQueue();
  const source = run(1, {
    id: 'source',
    configText: CONFIGURED_TEXT,
    provider: 'anthropic',
    attachments: [ATTACHMENT],
  });
  // A step skipped after the start: probes repeat the skip; a skip fixed at creation is part of the
  // snapshot of the run and comes with the variant.
  source.run.skippedSteps = ['review'];
  states.states.set('source', source);
  const configService = { load: () => parse(CONFIGURED_TEXT) } as unknown as ConfigService;
  const probeCheck: ProbeCheck =
    check ??
    (async (state) => ({
      applied: state.run.id.includes('strong'),
      conflicts: [],
    }));
  const probes = new RunProbes({
    states,
    launcher,
    store,
    config: configService,
    check: probeCheck,
    engine,
    now: () => 1000,
  });
  return { store, states, launcher, probes, engine };
}

function finishProbes(states: FakeStates, launcher: FakeLauncher): void {
  for (const id of launcher.created) {
    const state = run(1, { id });
    const work = group(state);
    work.status = 'merged';
    work.mergeCommit = 'merge';
    states.states.set(id, state);
  }
}

/** Finishes every created probe and lets the experiment create the repetition after them. */
async function settle(
  probes: RunProbes,
  states: FakeStates,
  launcher: FakeLauncher,
): Promise<void> {
  finishProbes(states, launcher);
  await probes.advance();
}

/** Creates every planned repetition: the first one comes from `start`. */
async function settleAll(
  probes: RunProbes,
  states: FakeStates,
  launcher: FakeLauncher,
  repetitions: number,
): Promise<void> {
  for (let repetition = 1; repetition < repetitions; repetition += 1) {
    await settle(probes, states, launcher);
  }
  finishProbes(states, launcher);
}

describe('the probes of a run', () => {
  it('creates the candidates on the task and base of the source run, one repetition at a time', async () => {
    const { probes, launcher, store, states } = setup();
    const view = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 2,
      maxRuns: 4,
    });
    expect(launcher.requests).toHaveLength(2);
    for (const request of launcher.requests) {
      expect(request).toMatchObject({
        repository: '/repo',
        pipeline: 'feature',
        groupTitle: 'Group 1',
        split: false,
        task: 'task 1',
        baseCommit: 'abc',
        provider: 'anthropic',
        skip: ['review'],
        attachments: [ATTACHMENT],
        number: 1,
      });
    }
    expect(launcher.requests.map((request) => request.variant)).toEqual(['default', 'strong']);
    expect(launcher.requests.map((request) => request.title)).toEqual([
      'probe default 1',
      'probe strong 1',
    ]);
    expect(view.status).toBe('running');
    expect(view.experiment).toMatchObject({
      provider: 'anthropic',
      skip: ['review'],
      groupTitle: 'Group 1',
      split: false,
      planned: 4,
      stopped: null,
      stopReason: null,
    });
    expect(view.experiment.runs).toHaveLength(2);
    expect(view.experiment.proposalPath).toBeNull();
    expect(store.experiments.get(view.experiment.id)?.runs).toHaveLength(2);

    // The next repetition starts only after every run of the previous one has settled.
    await settle(probes, states, launcher);
    expect(launcher.requests).toHaveLength(4);
    expect(launcher.requests.map((request) => request.variant)).toEqual([
      'default',
      'strong',
      'default',
      'strong',
    ]);
    expect(launcher.requests.map((request) => request.title)).toEqual([
      'probe default 1',
      'probe strong 1',
      'probe default 2',
      'probe strong 2',
    ]);
  });

  it('refuses a plan above its budget before creating any run', async () => {
    const { probes, launcher, store } = setup();
    await expect(
      probes.start({
        runId: 'source',
        candidates: ['default', 'strong'],
        repetitions: 3,
        maxRuns: 5,
      }),
    ).rejects.toThrow(/above the budget/);
    expect(launcher.requests).toHaveLength(0);
    expect(store.experiments.size).toBe(0);
  });

  it('refuses a variant the pipeline does not have', async () => {
    const { probes, launcher } = setup();
    await expect(
      probes.start({
        runId: 'source',
        candidates: ['default', 'missing'],
        repetitions: 1,
        maxRuns: 2,
      }),
    ).rejects.toThrow(/unknown variant/);
    expect(launcher.requests).toHaveLength(0);
  });

  it('refuses an unknown source run and an unknown experiment', async () => {
    const { probes } = setup();
    await expect(
      probes.start({
        runId: 'nope',
        candidates: ['default', 'strong'],
        repetitions: 1,
        maxRuns: 2,
      }),
    ).rejects.toThrow(/unknown run/);
    await expect(probes.show('prnope')).rejects.toThrow(/unknown probe experiment/);
  });

  it('warns that fewer repetitions than a decision needs cannot prove a win', async () => {
    const { probes } = setup();
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    expect(started.warnings).toHaveLength(1);
    expect(started.warnings[0]).toContain(`${MIN_DECIDING_PAIRS} decided pairs`);

    const { probes: full } = setup();
    const enough = await full.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: MIN_DECIDING_PAIRS,
      maxRuns: MIN_DECIDING_PAIRS * 2,
    });
    expect(enough.warnings).toEqual([]);
  });

  it('compares finished probes by the objective signal and writes a proposal once', async () => {
    const { probes, launcher, store, states } = setup();
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 6,
      maxRuns: 12,
    });
    await settleAll(probes, states, launcher, 6);
    expect(launcher.requests).toHaveLength(12);
    const view = await probes.show(started.experiment.id);
    expect(view.status).toBe('ready');
    expect(view.comparison.winner).toBe('strong');
    expect(view.comparison.versus[0]).toMatchObject({ wins: 6, losses: 0, significant: true });
    expect(view.proposalPath).toBe(`/state/probes/${started.experiment.id}.md`);
    expect(store.proposals.get(started.experiment.id)).toContain('probes never apply anything');
    // A second look reuses the written proposal instead of writing it again.
    const again = await probes.show(started.experiment.id);
    expect(again.proposalPath).toBe(view.proposalPath);
    expect(store.proposals.size).toBe(1);
  });

  it('keeps an experiment without a winner when its tokens ran over the budget', async () => {
    const { probes, launcher, states } = setup();
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
      maxTokens: 1,
    });
    for (const id of launcher.created) {
      const state = run(1, { id });
      const work = group(state);
      work.status = 'merged';
      work.mergeCommit = 'merge';
      work.attempts.push({ usage: { inputTokens: 10, outputTokens: 0 } } as never);
      states.states.set(id, state);
    }
    const view = await probes.show(started.experiment.id);
    expect(view.status).toBe('budget_exhausted');
    expect(view.comparison.winner).toBeNull();
    expect(view.comparison.proposal?.what).toBe(
      'no change: the experiment ran over its token budget',
    );
  });

  it('stops creating probes before the next repetition when the tokens reached the limit', async () => {
    const { probes, launcher, store, states } = setup({ tokens: 10 });
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 3,
      maxRuns: 6,
      maxTokens: 10,
    });
    // The first repetition is created before the budget is spent; nothing else is.
    expect(launcher.requests).toHaveLength(2);
    await probes.advance();
    const view = await probes.show(started.experiment.id);
    expect(launcher.requests).toHaveLength(2);
    expect(view.experiment).toMatchObject({ planned: 6, stopped: 'tokens' });
    expect(view.experiment.runs).toHaveLength(2);
    expect(view.status).toBe('budget_exhausted');
    expect(view.comparison.winner).toBeNull();
    expect(view.comparison.reason).toContain('stopped creating probes after 2 of 6');
    expect(store.experiments.get(view.experiment.id)?.stopped).toBe('tokens');
  });

  it('keeps a half-created experiment visible instead of throwing', async () => {
    const { probes, store } = setup({ failAt: 2 });
    const view = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 2,
      maxRuns: 4,
    });
    expect(view.status).toBe('failed');
    expect(view.experiment).toMatchObject({
      planned: 4,
      stopped: 'creation_failed',
      stopReason: 'the launcher failed',
    });
    expect(view.experiment.runs).toHaveLength(1);
    const [saved] = [...store.experiments.values()];
    expect(saved).toMatchObject({ planned: 4, stopped: 'creation_failed' });
    expect(saved?.runs).toHaveLength(1);
    const shown = await probes.show(saved!.id);
    expect(shown.status).toBe('failed');
    expect(shown.comparison.reason).toContain('1 of 4');
  });

  it('keeps a probe whose check failed out of the comparison instead of failing the whole show', async () => {
    const failing: ProbeCheck = async (state) => {
      if (state.run.id.includes('strong')) throw new Error('the base commit is gone');
      return { applied: true, conflicts: [] };
    };
    const { probes, launcher, states } = setup({}, failing);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 6,
      maxRuns: 12,
    });
    await settleAll(probes, states, launcher, 6);
    const view = await probes.show(started.experiment.id);
    expect(view.status).toBe('ready');
    expect(view.comparison.winner).toBeNull();
    expect(view.comparison.scores[1]).toMatchObject({ errors: 6 });
    expect(view.comparison.reason).toContain('could not be checked');
  });
});
