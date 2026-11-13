import { randomInt } from 'node:crypto';

import { rejected } from '../../../platform/errors/index.ts';
import { excludeWorkspace, prepareRunBranch, workspaceRoot } from '../../../platform/git/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import { findPipeline } from '../../swarm-config/types/index.ts';
import type { Event } from '../machine/index.ts';
import {
  checkSkip,
  createRun,
  groupsFromTask,
  runCreated,
  runId,
  type RunCreated,
  type RunRequest,
  type RunState,
} from '../types/index.ts';

import type { AttemptKey } from './effects/context.ts';
import type { RunEffects } from './effects/effects.ts';
import type { RunEngine } from './engine.ts';
import type { RunStates } from './states.ts';

export interface RunRequestsDependencies {
  states: RunStates;
  engine: RunEngine;
  effects: RunEffects;
  registry: RegistryService;
  config: ConfigService;
  now: () => number;
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
    const prepared = await prepareRunBranch(repository, `refs/aip/${id}/run`, {
      workingTree: config.workspace.base === 'working_tree',
      include: config.workspace.include,
      snapshotRef: `refs/aip/${id}/base`,
    });
    await excludeWorkspace(repository, workspaceRoot(repository, config.workspaceDir));
    const state = createRun({
      id,
      repository,
      pipeline: params.pipeline,
      baseCommit: prepared.baseCommit,
      config,
      dirtyWarning: prepared.dirty,
      groups: params.groups ?? groupsFromTask(params.task ?? ''),
      split: params.task !== undefined,
      fromQueue: true,
      queueItem: queueItem.id,
      number: queueItem.number,
      autoDeliver: params.autoDeliver,
      deliveryMode: params.deliveryMode,
      skip: params.skip,
      tags: tagIds,
      now: now(),
      ...(params.title ? { title: params.title } : {}),
    });
    return this.started(state, config.naming.enabled, prepared.dirty);
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
