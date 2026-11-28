import { describe, expect, it } from 'vitest';

import { Database } from '../../../src/platform/sqlite/index.ts';
import { RunProbes } from '../../../src/feature/runs/services/index.ts';
import { ProbeAdmissionRepository } from '../../../src/feature/runs/repositories/index.ts';
import {
  MIN_DECIDING_PAIRS,
  PROBE_LIMITS,
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
import type { RunStatsPort } from '../../../src/feature/runs/ports/stats/index.ts';
import { formatProbe } from '../../../src/presentation/format/probe/probe.ts';

import { CONFIG_TEXT, config as parse, group, run } from './helpers.ts';

const CONFIGURED_TEXT = `${CONFIG_TEXT.replace(
  'swarm:\n',
  'swarm:\n  providers:\n    anthropic: { name: Anthropic, access: [{ kind: cli, runtime: claude }] }\n',
)}      variants:\n        strong: {}\n`;

const ATTACHMENT = { id: 'a1', fileName: 'task.md', size: 4, mediaType: 'text/markdown' };

class MemoryStore implements ProbeStore {
  readonly experiments = new Map<string, ProbeExperiment>();
  readonly proposals = new Map<string, string>();
  proposalWrites = 0;

  save(experiment: ProbeExperiment): void {
    this.experiments.set(experiment.id, experiment);
  }

  load(id: string): ProbeExperiment | null {
    const experiment = this.experiments.get(id);
    return experiment ? structuredClone(experiment) : null;
  }

  list(): ProbeExperiment[] {
    return [...this.experiments.values()];
  }

  writeProposal(id: string, markdown: string): string {
    this.proposalWrites += 1;
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

function setup(launcherOptions: LauncherOptions = {}, check?: ProbeCheck, stats?: RunStatsPort) {
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
  const database = new Database(':memory:');
  const admissions = {
    repository: new ProbeAdmissionRepository(database, PROBE_LIMITS),
    states,
  };
  const rows = () =>
    database
      .prepare('SELECT id, root_run_id AS root, runs FROM probe_admissions ORDER BY id')
      .all() as { id: string; root: string; runs: number }[];
  const probes = new RunProbes({
    states,
    launcher,
    store,
    config: configService,
    check: probeCheck,
    engine,
    now: () => 1000,
    stats: stats ?? fakeStats(),
    admissions,
    probeRuns: () => [],
  });
  return { store, states, launcher, probes, engine, admissions, rows };
}

function fakeStats(overrides: Partial<RunStatsPort> = {}): RunStatsPort {
  return {
    capture: async () => {},
    read: () => ({ attempts: [], wallMs: null }),
    markProbes: () => {},
    ...overrides,
  };
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

  it('refuses a batch experiment above the exhausted budget of its task before anything exists', async () => {
    const { probes, launcher, store, admissions, rows } = setup();
    // Eleven places of the task are taken by the admissions of earlier requests.
    admissions.repository.restore({ id: 'earlier', rootRunId: 'source', runs: 11, now: 1000 });
    await expect(
      probes.start({
        runId: 'source',
        candidates: ['default', 'strong'],
        repetitions: 1,
        maxRuns: 2,
      }),
    ).rejects.toThrow('the probe budget of the task is exhausted: limit 12, used 11, requested 2');
    expect(launcher.requests).toHaveLength(0);
    expect(store.experiments.size).toBe(0);
    expect(rows()).toEqual([{ id: 'earlier', root: 'source', runs: 11 }]);
  });

  it('refuses a batch experiment above the budget of the window of 24 hours', async () => {
    const { probes, launcher, store, admissions, rows } = setup();
    for (let index = 0; index < 24; index += 1) {
      admissions.repository.restore({
        id: `other-${index}`,
        rootRunId: `other-${index}`,
        runs: 1,
        now: 1000,
      });
    }
    await expect(
      probes.start({
        runId: 'source',
        candidates: ['default', 'strong'],
        repetitions: 1,
        maxRuns: 2,
      }),
    ).rejects.toThrow(
      'the probe budget of the 24h window is exhausted: limit 24, used 24, requested 2',
    );
    expect(launcher.requests).toHaveLength(0);
    expect(store.experiments.size).toBe(0);
    expect(rows()).toHaveLength(24);
  });

  it('refuses a plan wider than the budget of any task, whatever the request asks for', async () => {
    const { probes, launcher, store, rows } = setup();
    // Two candidates of seven repetitions are fourteen runs: more than a task ever holds.
    await expect(
      probes.start({
        runId: 'source',
        candidates: ['default', 'strong'],
        repetitions: 7,
        maxRuns: 40,
      }),
    ).rejects.toThrow('the probe budget of the task is exhausted: limit 12, used 0, requested 14');
    expect(launcher.requests).toHaveLength(0);
    expect(store.experiments.size).toBe(0);
    expect(rows()).toEqual([]);
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
    expect(store.proposals.get(started.experiment.id)).toContain('use variant `strong`');
    expect(store.proposals.get(started.experiment.id)).toContain('probes never apply anything');
    // A second look reuses the written proposal instead of writing it again.
    const again = await probes.show(started.experiment.id);
    expect(again.proposalPath).toBe(view.proposalPath);
    expect(store.proposals.size).toBe(1);
    expect(store.proposalWrites).toBe(1);
  });

  it('offers no change when a single pair favors the candidate', async () => {
    const { probes, launcher, store, states } = setup();
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    const view = await probes.show(started.experiment.id);
    expect(view.status).toBe('ready');
    expect(view.comparison.winner).toBeNull();
    expect(view.comparison.versus[0]).toMatchObject({ pairs: 1, wins: 1, significant: false });
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(markdown).toContain('no change');
    expect(markdown).not.toContain('use variant');
    // The proposal never claims that anything was delivered or applied.
    expect(markdown).toContain('probes never apply anything');
  });

  it('publishes only once when two views check the same experiment concurrently', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    let bothEntered!: () => void;
    const both = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const check: ProbeCheck = async () => {
      entered += 1;
      if (entered === 2) bothEntered();
      await gate;
      return { applied: true, conflicts: [] };
    };
    const { probes, launcher, store, states } = setup({}, check);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    const first = probes.show(started.experiment.id);
    const second = probes.show(started.experiment.id);
    await both;
    release();
    const views = await Promise.all([first, second]);
    expect(views[0]!.proposalPath).not.toBeNull();
    expect(views[1]!.proposalPath).toBe(views[0]!.proposalPath);
    expect(store.proposalWrites).toBe(1);
  });

  it('waits for delayed statistics capture before writing the final proposal', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let ready = false;
    const stats: RunStatsPort = {
      capture: async () => {
        entered();
        await gate;
        ready = true;
      },
      read: (runId) => ({
        attempts: ready
          ? [
              {
                runId,
                group: 'group-1',
                seq: 1,
                durationMs: 1234,
                inputTokens: 456,
                outputTokens: 78,
              },
            ]
          : [],
        wallMs: ready ? 2345 : null,
      }),
      markProbes: () => {},
    };
    const { probes, launcher, store, states } = setup({}, undefined, stats);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    for (const id of launcher.created) {
      const work = group(states.lookup(id)!);
      work.attempts.push({
        seq: 1,
        status: 'done',
        stepId: 'code',
        round: 1,
        usage: { inputTokens: 456, outputTokens: 78 },
      } as never);
    }
    const pending = probes.show(started.experiment.id);
    await waiting;
    expect(store.proposalWrites).toBe(0);
    expect(store.load(started.experiment.id)?.proposalPath).toBeNull();
    release();
    const first = await pending;
    const again = await probes.show(started.experiment.id);
    expect(first.proposalPath).not.toBeNull();
    expect(again.proposalPath).toBe(first.proposalPath);
    expect(store.proposalWrites).toBe(1);
    expect(store.proposals.get(started.experiment.id)).toContain('1,234');
    expect(store.proposals.get(started.experiment.id)).toContain('456');
    expect(store.proposals.get(started.experiment.id)).toContain('78');
  });

  it('does not mistake journal placeholder zeros for candidate token savings', async () => {
    const stats: RunStatsPort = {
      capture: async () => {},
      read: (runId) => ({
        attempts: [
          {
            runId,
            group: 'group-1',
            seq: 1,
            durationMs: 100,
            inputTokens: runId.includes('strong') ? 0 : 10,
            outputTokens: 0,
          },
        ],
        wallMs: 100,
      }),
      markProbes: () => {},
    };
    const { probes, launcher, store, states } = setup(
      {},
      async () => ({ applied: true, conflicts: [] }),
      stats,
    );
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    for (const id of launcher.created) {
      group(states.lookup(id)!).attempts.push({
        seq: 1,
        status: 'finished',
        stepId: 'code',
        round: 1,
        ...(id.includes('strong') ? {} : { usage: { inputTokens: 10, outputTokens: 0 } }),
      } as never);
    }
    const view = await probes.show(started.experiment.id);
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(view.proposalPath).not.toBeNull();
    expect(markdown).toContain('| Input tokens | 10 | unknown |');
    expect(markdown).toContain('| Output tokens | 0 | unknown |');
    expect(markdown).toMatch(/`strong`:.*tokens unknown/);
    expect(markdown).toContain('measured tokens unknown');
    expect(markdown).not.toMatch(/`strong`:.*tokens 0(?:\D|$)/);
    expect(markdown).not.toMatch(/budget:.*\b\d+ tokens/);
    expect(markdown).not.toContain('## use variant');
    expect(markdown).not.toContain('tokens favors candidate');
    expect(markdown).toContain('Pair signal: **baseline**');
    expect(view.comparison.winner).toBeNull();
    const cli = formatProbe(view);
    expect(cli).toMatch(/`strong`:.*tokens unknown/);
    expect(cli).toContain('spent unknown token(s)');
    expect(cli).not.toMatch(/`strong`:.*tokens 0(?:\D|$)|spent 0 token\(s\)/);
  });

  it('reports measured zero in candidate and budget summaries', async () => {
    const stats: RunStatsPort = {
      capture: async () => {},
      read: (runId) => ({
        attempts: [
          { runId, group: 'group-1', seq: 1, durationMs: 100, inputTokens: 0, outputTokens: 0 },
        ],
        wallMs: 100,
      }),
      markProbes: () => {},
    };
    const { probes, launcher, store, states } = setup({}, undefined, stats);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    for (const id of launcher.created) {
      group(states.lookup(id)!).attempts.push({
        seq: 1,
        status: 'finished',
        stepId: 'code',
        round: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      } as never);
    }
    const view = await probes.show(started.experiment.id);
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(markdown).toMatch(/`strong`:.*tokens 0/);
    expect(markdown).toMatch(/budget:.* 0 tokens/);
    expect(markdown).not.toContain('measured tokens unknown');
    expect(formatProbe(view)).toMatch(/`strong`:.*tokens 0/);
    expect(formatProbe(view)).toContain('spent 0 token(s)');
  });

  it('formats missing and mixed attempt usage as unknown, not the accounted minimum', async () => {
    const stats: RunStatsPort = {
      capture: async () => {},
      read: (runId) => ({
        attempts: [1, 2].map((seq) => ({
          runId,
          group: 'group-1',
          seq,
          durationMs: 100,
          inputTokens: seq === 1 ? 7 : 0,
          outputTokens: 0,
        })),
        wallMs: 200,
      }),
      markProbes: () => {},
    };
    const { probes, launcher, store, states } = setup({}, undefined, stats);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    for (const id of launcher.created) {
      const attempts = group(states.lookup(id)!).attempts;
      attempts.push({
        seq: 1,
        status: 'finished',
        stepId: 'code',
        round: 1,
        ...(id.includes('strong') ? {} : { usage: { inputTokens: 7, outputTokens: 0 } }),
      } as never);
      attempts.push({ seq: 2, status: 'finished', stepId: 'code', round: 1 } as never);
    }
    const view = await probes.show(started.experiment.id);
    const cli = formatProbe(view);
    expect(view.comparison.spent.tokens).toBe(7);
    expect(cli).toMatch(/`default` \(baseline\):.*tokens unknown/);
    expect(cli).toMatch(/`strong`:.*tokens unknown/);
    expect(cli).toContain('spent unknown token(s)');
    expect(cli).not.toMatch(/tokens (?:0|7)(?:\D|$)|spent (?:0|7) token\(s\)/);
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(markdown).toMatch(/`default`:.*tokens unknown/);
    expect(markdown).toMatch(/`strong`:.*tokens unknown/);
    expect(markdown).toContain('measured tokens unknown');
  });

  it('publishes unknown measurements if statistics capture fails', async () => {
    const stats: RunStatsPort = {
      capture: async () => {
        throw new Error('journal unavailable');
      },
      read: () => {
        throw new Error('unexpected read');
      },
      markProbes: () => {},
    };
    const { probes, launcher, store, states } = setup({}, undefined, stats);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    const view = await probes.show(started.experiment.id);
    expect(view.proposalPath).not.toBeNull();
    expect(store.proposals.get(started.experiment.id)).toContain('unknown');
    expect(store.proposalWrites).toBe(1);
  });

  it('does not publish or overwrite newly created runs from a stale view', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const check: ProbeCheck = async () => {
      entered();
      await gate;
      return { applied: true, conflicts: [] };
    };
    const { probes, launcher, store, states, engine } = setup({}, check);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 2,
      maxRuns: 4,
    });
    finishProbes(states, launcher);
    engine.stopping = true;
    const stale = probes.show(started.experiment.id);
    await waiting;
    engine.stopping = false;
    await probes.advance();
    expect(store.load(started.experiment.id)?.runs).toHaveLength(4);
    release();
    const view = await stale;
    expect(view.experiment.runs).toHaveLength(4);
    expect(store.load(started.experiment.id)?.runs).toHaveLength(4);
    expect(store.proposalWrites).toBe(0);
    finishProbes(states, launcher);
    const complete = await probes.show(started.experiment.id);
    expect(complete.proposalPath).not.toBeNull();
    expect(store.proposalWrites).toBe(1);
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

  it('waits for every created probe before saving a budget-exhausted proposal', async () => {
    const { probes, launcher, states, store } = setup();
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 2,
      maxRuns: 4,
      maxTokens: 10,
    });
    await settle(probes, states, launcher);
    expect(launcher.created).toHaveLength(4);
    const completed = run(1, { id: launcher.created[2] });
    group(completed).status = 'merged';
    group(completed).attempts.push({ usage: { inputTokens: 11, outputTokens: 0 } } as never);
    states.states.set(launcher.created[2]!, completed);
    const unfinished = await probes.show(started.experiment.id);
    expect(unfinished.status).toBe('budget_exhausted');
    expect(unfinished.proposalPath).toBeNull();
    expect(store.proposalWrites).toBe(0);
    finishProbes(states, launcher);
    const finished = await probes.show(started.experiment.id);
    expect(finished.proposalPath).not.toBeNull();
    expect(store.proposalWrites).toBe(1);
    expect(store.proposals.get(started.experiment.id)).not.toContain('Insufficient pair data');
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
    const { probes, launcher, states, store } = setup({}, failing);
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
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(markdown).toContain(
      '`strong`: clean 0/0 (unknown; checked probes only), conflicts unknown',
    );
    expect(markdown).toContain('`default`: clean 6/6 (100%; checked probes only), conflicts 0');
    expect(markdown).toContain('the base commit is gone');
    expect(markdown).not.toContain('clean 0/0 (0%');
    expect(markdown).not.toContain('use variant');
  });

  it('preserves unknown conflicts across mixed successful and failed checks', async () => {
    const check: ProbeCheck = async (state) => {
      if (state.run.id === 'probe-strong-4') throw new Error('check unavailable');
      return { applied: true, conflicts: [] };
    };
    const { probes, launcher, states, store } = setup({}, check);
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 2,
      maxRuns: 4,
    });
    await settleAll(probes, states, launcher, 2);
    const view = await probes.show(started.experiment.id);
    expect(view.comparison.scores[1]).toMatchObject({ errors: 1, conflicts: null });
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(markdown).toContain(
      '`strong`: clean 1/1 (100%; checked probes only), conflicts unknown',
    );
    expect(markdown).toContain('check unavailable');
    expect(markdown).not.toContain('use variant');
  });

  it('does not report zero conflicts or a zero percentage when both checks throw', async () => {
    const { probes, launcher, states, store } = setup({}, async () => {
      throw new Error('check unavailable');
    });
    const started = await probes.start({
      runId: 'source',
      candidates: ['default', 'strong'],
      repetitions: 1,
      maxRuns: 2,
    });
    finishProbes(states, launcher);
    const view = await probes.show(started.experiment.id);
    expect(view.comparison.scores.map((score) => score.conflicts)).toEqual([null, null]);
    const markdown = store.proposals.get(started.experiment.id)!;
    expect(markdown).toContain('check unavailable');
    expect(markdown).toContain('conflicts unknown');
    expect(markdown).toContain('clean 0/0 (unknown; checked probes only)');
    expect(markdown).not.toMatch(/conflicts 0|clean 0\/0 \(0%|use variant/);
  });
});

describe('the reservations of an older daemon', () => {
  /** The stored experiment of a daemon before this change, with its first repetition created. */
  function olderWorld() {
    const database = new Database(':memory:');
    const rows = () =>
      database
        .prepare(
          'SELECT id, root_run_id AS root, runs, admitted_at AS at FROM probe_admissions ORDER BY id',
        )
        .all() as { id: string; root: string; runs: number; at: number }[];
    const states = new FakeStates();
    const source = run(1, {
      id: 'source',
      configText: CONFIGURED_TEXT,
      provider: 'anthropic',
      attachments: [ATTACHMENT],
    });
    source.run.skippedSteps = ['review'];
    states.states.set('source', source);
    const members = ['member-default-1', 'member-strong-1'];
    for (const id of members) {
      const state = run(1, { id, configText: CONFIGURED_TEXT });
      const work = group(state);
      work.status = 'merged';
      work.mergeCommit = 'merge';
      states.states.set(id, state);
    }
    const store = new MemoryStore();
    store.save({
      id: 'old',
      repository: '/repo',
      sourceRun: 'source',
      sourceGroup: 'group-1',
      groupTitle: 'Group 1',
      split: false,
      pipeline: 'feature',
      task: 'task 1',
      baseCommit: 'abc',
      provider: 'anthropic',
      skip: ['review'],
      candidates: ['default', 'strong'],
      repetitions: 2,
      budget: { maxRuns: 4, maxTokens: null },
      planned: 4,
      stopped: null,
      stopReason: null,
      runs: [
        { candidate: 'default', repetition: 1, runId: 'member-default-1' },
        { candidate: 'strong', repetition: 1, runId: 'member-strong-1' },
      ],
      createdAt: 500,
      proposalPath: null,
    });
    return { database, rows, states, store, members };
  }

  it('restores the reserves and the origin once and continues the old experiment', async () => {
    const { database, rows, states, store, members } = olderWorld();
    const launcher = new FakeLauncher(states);
    const marked: string[][] = [];
    const stats = fakeStats({ markProbes: (ids) => marked.push([...ids]) });
    const admissions = {
      repository: new ProbeAdmissionRepository(database, PROBE_LIMITS),
      states,
    };
    const probeRuns = [{ id: 'lone-probe', probeOf: 'source', createdAt: 700 }];
    const build = () =>
      new RunProbes({
        states,
        launcher,
        store,
        config: { load: () => parse(CONFIGURED_TEXT) } as unknown as ConfigService,
        check: async () => ({ applied: true, conflicts: [] }),
        engine: new FakeQueue(),
        now: () => 1000,
        stats,
        admissions,
        probeRuns: () => probeRuns,
      });

    // The first start of the new daemon restores the plan of the older store and the lone probe
    // of the table of runs, and tells the journal which runs belong to probes.
    await build().advance();
    expect(rows()).toEqual([
      { id: 'lone-probe', root: 'source', runs: 1, at: 700 },
      { id: 'old', root: 'source', runs: 4, at: 500 },
    ]);
    expect(marked).toEqual([members]);
    // The old experiment goes on: the second repetition repeats the configuration of the first
    // run of its variant and belongs to the source run from the moment of creation.
    expect(launcher.requests.map((request) => request.title)).toEqual([
      'probe default 2',
      'probe strong 2',
    ]);
    for (const request of launcher.requests) {
      expect(request.probeOf).toBe('source');
      expect(request.config).toEqual(
        states.lookup(request.title.includes('default') ? members[0]! : members[1]!)!.run.config,
      );
    }
    // The next repetition spends no new places: the plan took them all at admission.
    expect(rows()).toHaveLength(2);

    // The restart of the daemon writes the same reservations again: no places and no records twice.
    await build().advance();
    expect(rows()).toEqual([
      { id: 'lone-probe', root: 'source', runs: 1, at: 700 },
      { id: 'old', root: 'source', runs: 4, at: 500 },
    ]);
    // The members of the repetition the restart took over are named too; writing it again
    // changes nothing in the journal.
    expect(marked[0]).toEqual(members);
    expect(marked[1]).toEqual([...members, 'probe-default-1', 'probe-strong-2']);
    expect(launcher.requests).toHaveLength(2);
    database.close();
  });
});
