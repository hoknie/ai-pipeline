import { randomInt } from 'node:crypto';

import { rejected } from '../../../platform/errors/index.ts';
import {
  excludeWorkspace,
  prepareRunBranch,
  refExists,
  runGit,
  resolveBase,
  workspaceRoot,
} from '../../../platform/git/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import {
  requireDeliveryMode,
  serverModeOn,
  type ConfigService,
} from '../../swarm-config/services/index.ts';
import { findPipeline } from '../../swarm-config/types/index.ts';
import type { Event } from '../machine/index.ts';
import { reserveProbes } from './probes/admission.ts';
import type { ProbeAdmissions } from './probes/admission.ts';
import {
  checkSkip,
  checkDeliveryBranch,
  createRun,
  groupsFromTask,
  oppositeHarness,
  probeInputOf,
  runCreated,
  runId,
  sameProbeInput,
  type Harness,
  type NewGroup,
  type ProbeRunRequest,
  type RunCreated,
  type RunRequest,
  type RunState,
} from '../types/index.ts';

import type { AttemptKey } from './effects/context.ts';
import type { RunEffects } from './effects/effects.ts';
import { providerEvent } from './refresh.ts';
import type { RunEngine } from './engine.ts';
import type { RunStates } from './states.ts';

export interface RunRequestsDependencies {
  states: RunStates;
  engine: RunEngine;
  effects: RunEffects;
  registry: RegistryService;
  config: ConfigService;
  now: () => number;
  /** The admissions of the probe budget: a single probe takes one place before any side effect. */
  admissions: ProbeAdmissions;
}

/** The changes of runs the clients and the agents ask for. */
export class RunRequests {
  private readonly dependencies: RunRequestsDependencies;

  constructor(dependencies: RunRequestsDependencies) {
    this.dependencies = dependencies;
  }

  /** Applies an event to the run in the queue of the daemon and returns the run. */
  event(runId: string, event: Event | ((state: RunState) => Event)): Promise<RunState> {
    const { engine, states } = this.dependencies;
    return engine.serial(async () => {
      const state = states.get(runId);
      await engine.apply(state, typeof event === 'function' ? event(state) : event);
      return state;
    });
  }

  /** The run goes on with another provider (null: none); an unknown provider refuses the request. */
  setProvider(runId: string, provider: string | null): Promise<RunState> {
    const { config } = this.dependencies;
    return this.event(runId, (state) => providerEvent(config, state, provider));
  }

  /** An event reported by the worker MCP server of a running attempt. */
  workerEvent(token: string, build: (key: AttemptKey) => Event): Promise<{ recorded: true }> {
    const { engine, states, effects } = this.dependencies;
    return engine.serial(async () => {
      const key = effects.attemptFor(token);
      if (!key) throw rejected('unknown or expired report token');
      await engine.apply(states.get(key.run), build(key));
      return { recorded: true as const };
    });
  }

  /** `run_title`: the title the user gave. */
  async setTitle(runId: string, title: string): Promise<RunState> {
    const state = this.dependencies.states.get(runId);
    await this.dependencies.engine.apply(state, { kind: 'title_set', title });
    return state;
  }

  /** `run_auto_deliver_cancel`: turns the automatic delivery of an unfinished run off. */
  async cancelAutoDelivery(runId: string): Promise<RunState> {
    const state = this.dependencies.states.get(runId);
    await this.dependencies.engine.apply(state, { kind: 'auto_delivery_cancelled' });
    return state;
  }

  /** Creates the run of a queue item:the branch, the run itself, the naming in the background. */
  async create(
    params: RunRequest,
    tagIds: string[],
    queueItem: { id: string; number: number },
  ): Promise<RunCreated> {
    const { registry, config: configs, now } = this.dependencies;
    const repository = await registry.rootOf(params.repository);
    const config = configs.load(repository);
    if (!findPipeline(config, params.pipeline)) {
      const known = config.pipelines.map((pipeline) => pipeline.id).join(', ') || 'none';
      throw rejected(`unknown pipeline \`${params.pipeline}\`; known: ${known}`);
    }
    const skipError = checkSkip(config, params.pipeline, params.skip ?? []);
    if (skipError !== null) throw rejected(skipError);
    const id = runId(now(), randomInt(36 ** 4));
    requireDeliveryMode(configs, params.deliveryMode);
    checkDeliveryBranch(
      params.deliveryBranch,
      params.autoDeliver ?? config.delivery.auto,
      params.deliveryMode ?? config.delivery.mode,
      serverModeOn(configs),
    );
    await checkTargetRef(repository, params.deliveryBranch);
    // The server mode: the run starts from the main branch of the remote repository, fetched now.
    const { remote, baseBranch } = config.delivery;
    const remoteBase = serverModeOn(configs)
      ? await resolveBase(repository, remote, baseBranch ?? null)
      : null;
    const prepared = await prepareRunBranch(repository, `refs/aip/${id}/run`, {
      workingTree: remoteBase === null && config.workspace.base === 'working_tree',
      include: remoteBase === null ? config.workspace.include : [],
      snapshotRef: `refs/aip/${id}/base`,
      commit: remoteBase?.commit,
    });
    await excludeWorkspace(repository, workspaceRoot(repository, config.workspaceDir));
    const state = createRun({
      id,
      repository,
      pipeline: params.pipeline,
      baseCommit: prepared.baseCommit,
      config,
      dirtyWarning: prepared.dirty,
      groups: params.groups ?? groupsFromTask(params.task ?? '', params.title),
      split: params.task !== undefined,
      fromQueue: true,
      queueItem: queueItem.id,
      number: queueItem.number,
      autoDeliver: params.autoDeliver,
      deliveryMode: params.deliveryMode,
      deliveryBranch: params.deliveryBranch,
      sourceCommit: prepared.sourceCommit,
      sourceBranch: prepared.sourceBranch,
      skip: params.skip,
      variant: params.variant,
      provider: params.provider,
      author: params.author,
      createdBySystem: params.createdBySystem,
      attachments: params.attachments,
      tags: tagIds,
      now: now(),
      ...(params.title ? { title: params.title } : {}),
    });
    return this.started(state, config.naming.enabled, prepared.dirty);
  }

  /**
   * `run_probe`: the same task, base commit and configuration as the run it probes, in another
   * harness. Its own id gives it its own refs and worktrees; an explicit `apply` is its only way
   * into the working tree.
   */
  async probe(baseId: string, harness?: Harness): Promise<RunCreated> {
    const { registry, now } = this.dependencies;
    const base = this.dependencies.states.get(baseId);
    if (base.run.cleanedAt !== null) {
      throw rejected(`run ${baseId} is cleaned up; there is no tree to probe`);
    }
    const chosen = harness ?? oppositeHarness(base.run.harness);
    if (chosen === base.run.harness) {
      throw rejected(`run ${baseId} already runs the ${chosen} harness`);
    }
    const repository = await registry.rootOf(base.run.repository);
    const id = runId(now(), randomInt(36 ** 4));
    const state = createRun({
      id,
      repository,
      pipeline: base.run.pipeline,
      baseCommit: base.run.baseCommit,
      config: base.run.config,
      configIsResolved: true,
      dirtyWarning: false,
      groups: probeGroups(base),
      split: base.split !== null,
      fromQueue: false,
      number: base.run.number,
      variant: base.run.variant,
      provider: base.run.provider,
      author: base.run.author,
      createdBySystem: base.run.createdBySystem,
      attachments: base.run.attachments,
      tags: base.run.tags,
      harness: chosen,
      probeOf: base.run.id,
      now: now(),
      ...(base.run.title ? { title: base.run.title } : {}),
    });
    if (!sameProbeInput(probeInputOf(base), probeInputOf(state))) {
      throw rejected(`a probe of run ${baseId} must repeat its input`);
    }
    // The place of the task is taken before the first side effect: a refusal leaves no refs.
    reserveProbes(this.dependencies.admissions, {
      id,
      run: baseId,
      runs: 1,
      now: now(),
    });
    await prepareRunBranch(repository, state.run.branch, {
      workingTree: false,
      include: [],
      snapshotRef: null,
      commit: base.run.baseCommit,
    });
    await excludeWorkspace(repository, workspaceRoot(repository, base.run.config.workspaceDir));
    return this.started(state, false, false);
  }

  /**
   * Creates the run of a probe: one task from one base commit with one variant of the harness. The
   * run is not a queue item, never delivers by itself and shares the task number of its source run.
   */
  async createProbe(request: ProbeRunRequest): Promise<RunCreated> {
    const { registry, config: configs, now } = this.dependencies;
    const repository = await registry.rootOf(request.repository);
    // A pinned configuration is the resolved one of the first run of the variant; the first
    // repetition reads `swarm.yaml` and resolves its variant as any run does.
    const config = request.config ?? configs.load(repository);
    const id = runId(now(), randomInt(36 ** 4));
    const prepared = await prepareRunBranch(repository, `refs/aip/${id}/run`, {
      workingTree: false,
      include: [],
      snapshotRef: `refs/aip/${id}/base`,
      commit: request.baseCommit,
    });
    const state = createRun({
      id,
      repository,
      pipeline: request.pipeline,
      baseCommit: prepared.baseCommit,
      config,
      configIsResolved: request.config !== undefined,
      dirtyWarning: false,
      groups: [{ title: request.groupTitle, task: request.task }],
      split: request.split,
      fromQueue: false,
      queueItem: null,
      number: request.number,
      autoDeliver: false,
      skip: request.skip,
      variant: request.variant,
      provider: request.provider,
      attachments: request.attachments,
      probeOf: request.probeOf,
      now: now(),
      title: request.title,
    });
    return this.started(state, false, false);
  }

  private async started(state: RunState, naming: boolean, dirty: boolean): Promise<RunCreated> {
    const { states, engine, effects } = this.dependencies;
    states.add(state);
    engine.save(state);
    await engine.schedule();
    if (state.run.title === null && naming) void effects.nameRun(state);
    return runCreated(
      state,
      dirty ? ['the repository has uncommitted changes; they are not part of this run'] : [],
    );
  }
}

async function checkTargetRef(
  repository: string,
  target: RunRequest['deliveryBranch'],
): Promise<void> {
  if (!target) return;
  if (
    (
      await runGit(repository, ['check-ref-format', '--branch', target.name], {
        allowFailure: true,
      })
    ).code !== 0
  )
    throw rejected('deliveryBranch must contain a valid local branch name');
  const exists = await refExists(repository, `refs/heads/${target.name}`);
  if (target.strategy === 'existing' && !exists)
    throw rejected(`deliveryBranch \`${target.name}\` does not exist`);
  if (target.strategy === 'create' && exists)
    throw rejected(`deliveryBranch \`${target.name}\` already exists`);
}

/** The groups of a probe: the split task again, or the groups of the run as they were given. */
function probeGroups(base: RunState): NewGroup[] {
  if (base.split !== null) return groupsFromTask(base.split.task, base.run.title ?? undefined);
  return base.groups.map(({ title, task }) => ({ title, task }));
}
