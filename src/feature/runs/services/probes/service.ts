import { randomInt } from 'node:crypto';

import { rejected } from '../../../../platform/errors/index.ts';
import type { ConfigService } from '../../../swarm-config/services/index.ts';
import type { RunStatsPort } from '../../ports/stats/index.ts';
import { createBatch } from './create-batch.ts';
import { restoreActive, reserveProbes, type ProbeAdmissions } from './admission.ts';
import { harnessProbe } from './harness-probe.ts';
import { keepProposal } from './keep-proposal.ts';
import { probeStats } from './probe-stats.ts';
import {
  type ResolvedConfig,
  checkVariant,
  findPipeline,
} from '../../../swarm-config/types/index.ts';
import {
  MIN_DECIDING_PAIRS,
  compareExperiment,
  isRunFinished,
  isSplitGroup,
  observeRun,
  planProbes,
  probeId,
  probeTokens,
  sourceSkip,
  type Group,
  type ProbeCheck,
  type ProbeExperiment,
  type ProbeLauncher,
  type ProbeObservation,
  type ProbeQueue,
  type ProbeRunSpec,
  type ProbeStartRequest,
  type ProbeStates,
  type ProbeStore,
  type ProbeView,
  type RunState,
} from '../../types/index.ts';

export interface RunProbesDependencies {
  states: ProbeStates;
  launcher: ProbeLauncher;
  store: ProbeStore;
  config: ConfigService;
  check: ProbeCheck;
  engine: ProbeQueue;
  now: () => number;
  stats: RunStatsPort;
  /** The admissions of the budget: the reserve of a plan and the restore of an old one. */
  admissions: ProbeAdmissions;
  /** Every run the table of runs names a probe; the restore of the places they took. */
  probeRuns: () => { id: string; probeOf: string; createdAt: number }[];
}

function groupOf(state: RunState, slug: string | null): Group {
  if (slug === null) {
    const [first] = state.groups;
    if (!first) throw rejected(`run ${state.run.id} has no work groups to probe`);
    return first;
  }
  const group = state.groups.find((candidate) => candidate.slug === slug);
  if (!group) throw rejected(`run ${state.run.id} has no work group \`${slug}\``);
  return group;
}

function validateVariants(config: ResolvedConfig, pipeline: string, candidates: string[]): void {
  if (!findPipeline(config, pipeline)) {
    throw rejected(`unknown pipeline \`${pipeline}\``);
  }
  for (const candidate of candidates) {
    const problem = checkVariant(config, pipeline, candidate);
    if (problem !== null) throw rejected(problem);
  }
}

/** The tokens the probes of the experiment have used so far, live attempts included. */
function spentTokens(states: ProbeStates, experiment: ProbeExperiment): number {
  return experiment.runs.reduce((total, run) => {
    const state = states.lookup(run.runId);
    return total + (state === undefined ? 0 : probeTokens(state));
  }, 0);
}

/** The last repetition with a created run; 0 before the first batch. */
function lastRepetition(experiment: ProbeExperiment): number {
  return experiment.runs.reduce((last, run) => Math.max(last, run.repetition), 0);
}

function isActive(experiment: ProbeExperiment): boolean {
  return experiment.stopped === null && experiment.runs.length < experiment.planned;
}

function specsOf(experiment: ProbeExperiment, repetition: number): ProbeRunSpec[] {
  return experiment.candidates.map((candidate) => ({ candidate, repetition }));
}

/** Every run of the repetition has settled: the experiment may spend its budget and go on. */
function batchDone(states: ProbeStates, experiment: ProbeExperiment, repetition: number): boolean {
  const runs = experiment.runs.filter((run) => run.repetition === repetition);
  if (runs.length === 0) return false;
  return runs.every((run) => {
    const state = states.lookup(run.runId);
    return state !== undefined && isRunFinished(state);
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warningsOf(experiment: ProbeExperiment): string[] {
  if (experiment.repetitions >= MIN_DECIDING_PAIRS) return [];
  return [
    `${experiment.repetitions} repetition(s) per candidate: a difference needs at least ${MIN_DECIDING_PAIRS} decided pairs to be significant`,
  ];
}

/**
 * Contrast probes: the same task and base commit with two variants of the harness, compared by the
 * objective signal of their runs. Probes never deliver: a winner is only proposed to a person.
 *
 * The first repetition starts at once; every next one is created after the previous one settles, so
 * the token budget is checked before the experiment spends more. A change of any run asks the
 * probes to advance, including after a restart, where the stored experiments are read again.
 */
export class RunProbes {
  private readonly dependencies: RunProbesDependencies;
  private readonly active = new Map<string, ProbeExperiment>();
  private loaded = false;
  private requested = false;

  constructor(dependencies: RunProbesDependencies) {
    this.dependencies = dependencies;
  }

  /** Plans and starts the probes of a run; the plan is checked against the budget first. */
  async start(params: ProbeStartRequest): Promise<ProbeView> {
    const source = this.dependencies.states.lookup(params.runId);
    if (!source) throw rejected(`unknown run \`${params.runId}\``);
    const group = groupOf(source, params.group ?? null);
    const config = this.dependencies.config.load(source.run.repository);
    const plan = planProbes({
      sourceRun: source.run.id,
      sourceGroup: group.slug,
      repository: source.run.repository,
      pipeline: source.run.pipeline,
      task: group.task,
      baseCommit: source.run.baseCommit,
      candidates: params.candidates,
      repetitions: params.repetitions,
      budget: { maxRuns: params.maxRuns, maxTokens: params.maxTokens ?? null },
    });
    validateVariants(config, plan.pipeline, plan.candidates);
    const experiment: ProbeExperiment = {
      id: probeId(this.dependencies.now(), randomInt(36 ** 4)),
      repository: plan.repository,
      sourceRun: plan.sourceRun,
      sourceGroup: plan.sourceGroup,
      groupTitle: group.title,
      split: isSplitGroup(group),
      pipeline: plan.pipeline,
      task: plan.task,
      baseCommit: plan.baseCommit,
      provider: source.run.provider,
      skip: sourceSkip(config, source),
      candidates: plan.candidates,
      repetitions: plan.repetitions,
      budget: plan.budget,
      planned: plan.runs.length,
      stopped: null,
      stopReason: null,
      runs: [],
      createdAt: this.dependencies.now(),
      proposalPath: null,
    };
    // The reservations of the plans of an earlier life are restored before this one is checked.
    this.restore();
    reserveProbes(this.dependencies.admissions, {
      id: experiment.id,
      run: experiment.sourceRun,
      runs: plan.runs.length,
      now: this.dependencies.now(),
    });
    this.active.set(experiment.id, experiment);
    // The plan is stored before the first run exists: a failure of the launcher leaves a visible
    // experiment with the runs it did create, not orphaned probes nobody can find.
    this.dependencies.store.save(experiment);
    try {
      await createBatch(
        this.dependencies.launcher,
        this.dependencies.states,
        experiment,
        specsOf(experiment, 1),
        source,
      );
      this.dependencies.store.save(experiment);
    } catch (error) {
      experiment.stopped = 'creation_failed';
      experiment.stopReason = reasonOf(error);
      this.dependencies.store.save(experiment);
      this.active.delete(experiment.id);
    }
    return this.viewOf(experiment);
  }

  /** The experiment by id, without reading its runs; null when there is none. */
  find(id: string): ProbeExperiment | null {
    return this.dependencies.store.load(id);
  }

  /** The comparison of an experiment: the probes still running, or the proposal. */
  async show(id: string): Promise<ProbeView> {
    const experiment = this.dependencies.store.load(id);
    if (experiment === null) throw rejected(`unknown probe experiment \`${id}\``);
    this.request();
    return this.viewOf(experiment);
  }

  /** A run changed: the probes look at their experiments once, however many changes arrive. */
  request(): void {
    if (this.dependencies.engine.stopping || this.requested) return;
    this.requested = true;
    void this.dependencies.engine
      .serial(async () => {
        try {
          await this.advance();
        } finally {
          this.requested = false;
        }
      })
      .catch(() => undefined);
  }

  /** Creates the next repetition of every stored experiment whose last one has settled. */
  async advance(): Promise<void> {
    if (this.dependencies.engine.stopping) return;
    this.restore();
    for (const experiment of [...this.active.values()]) await this.advanceOne(experiment);
  }

  /**
   * The experiments and the reservations of an older daemon, once, before any new request: after
   * a restart the runner takes them over, and the first admission must see the places they took.
   */
  restore(): void {
    if (this.loaded) return;
    this.loaded = true;
    const experiments = this.dependencies.store.list();
    for (const experiment of experiments) {
      if (isActive(experiment)) this.active.set(experiment.id, experiment);
    }
    // The plans admitted before count as admitted: the reservations are written again by their
    // ids, so a restart neither widens the budget nor re-checks an old experiment.
    restoreActive(
      this.dependencies.admissions,
      { experiments, probeRuns: this.dependencies.probeRuns() },
      (ids) => this.dependencies.stats.markProbes(ids),
    );
  }

  /** One experiment: wait for the last repetition, check the budget, create the next one. */
  private async advanceOne(experiment: ProbeExperiment): Promise<void> {
    if (!isActive(experiment)) {
      this.active.delete(experiment.id);
      return;
    }
    const last = lastRepetition(experiment);
    // The first repetition belongs to `start`; no run yet means nothing to wait for.
    if (last === 0 || !batchDone(this.dependencies.states, experiment, last)) return;
    if (last >= experiment.repetitions) {
      this.active.delete(experiment.id);
      return;
    }
    const limit = experiment.budget.maxTokens;
    if (limit !== null && spentTokens(this.dependencies.states, experiment) >= limit) {
      experiment.stopped = 'tokens';
      this.dependencies.store.save(experiment);
      this.active.delete(experiment.id);
      return;
    }
    const source = this.dependencies.states.lookup(experiment.sourceRun);
    if (source === undefined) {
      experiment.stopped = 'creation_failed';
      experiment.stopReason = `the source run \`${experiment.sourceRun}\` is gone`;
      this.dependencies.store.save(experiment);
      this.active.delete(experiment.id);
      return;
    }
    try {
      await createBatch(
        this.dependencies.launcher,
        this.dependencies.states,
        experiment,
        specsOf(experiment, last + 1),
        source,
      );
    } catch (error) {
      experiment.stopped = 'creation_failed';
      experiment.stopReason = reasonOf(error);
      this.dependencies.store.save(experiment);
      this.active.delete(experiment.id);
      return;
    }
    this.dependencies.store.save(experiment);
  }

  private async observe(experiment: ProbeExperiment): Promise<ProbeObservation[]> {
    const observations: ProbeObservation[] = [];
    for (const run of experiment.runs) {
      const state = this.dependencies.states.lookup(run.runId) ?? null;
      let check = null;
      let error: string | null = null;
      if (state !== null && isRunFinished(state)) {
        try {
          check = await this.dependencies.check(state);
        } catch (cause) {
          error = reasonOf(cause);
        }
      }
      const observation = observeRun(run, state, check, error);
      observations.push(
        state === null
          ? observation
          : {
              ...observation,
              summary: harnessProbe(
                state,
                check,
                error,
                await probeStats(this.dependencies.stats, state),
              ),
            },
      );
    }
    return observations;
  }

  private async viewOf(experiment: ProbeExperiment): Promise<ProbeView> {
    const comparison = compareExperiment(experiment, await this.observe(experiment));
    const current = keepProposal(this.dependencies.store, experiment, comparison);
    return {
      experiment: current,
      status: comparison.status,
      comparison,
      proposalPath: current.proposalPath,
      warnings: warningsOf(current),
    };
  }
}
