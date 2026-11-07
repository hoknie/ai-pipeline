import type { Effect } from '../../machine/index.ts';
import type { AgentRoot, Group, RunState } from '../../types/index.ts';
import type { EffectRunner } from '../engine.ts';

import { ActionRunner } from './actions.ts';
import { AttemptStarter } from './attempts.ts';
import type { AttemptKey, EffectDependencies } from './context.ts';
import { GitEffects } from './git.ts';
import { nameRun } from './naming.ts';
import { OutsideChanges } from './outside.ts';
import { RunningAgents } from './running.ts';
import { UsageBuffers } from './usage.ts';
import { logPath, worktreePath } from './worktrees.ts';

/** Carries out the effects of the machine: agents, command actions, git and the delivery. */
export class RunEffects implements EffectRunner {
  private readonly dependencies: EffectDependencies;
  private readonly running = new RunningAgents();
  private readonly usage: UsageBuffers;
  private readonly actions: ActionRunner;
  private readonly attempts: AttemptStarter;
  private readonly git: GitEffects;

  constructor(dependencies: EffectDependencies) {
    this.dependencies = dependencies;
    const outside = new OutsideChanges();
    this.usage = new UsageBuffers(dependencies.context, () => dependencies.timings.usageIntervalMs);
    this.actions = new ActionRunner(dependencies, this.running);
    this.attempts = new AttemptStarter(dependencies, {
      running: this.running,
      usage: this.usage,
      outside,
      actions: this.actions,
    });
    this.git = new GitEffects(dependencies, this.actions, outside);
  }

  async perform(state: RunState, effects: Effect[]): Promise<void> {
    for (const effect of effects) await this.performOne(state, effect);
  }

  busy(): boolean {
    return this.running.busy();
  }

  async stopAll(): Promise<void> {
    this.usage.clear();
    await this.running.stopAll();
  }

  /** Agents that run now: running attempts and the naming of runs. */
  agentRoots(): AgentRoot[] {
    return this.running.roots();
  }

  /** The attempt a worker MCP server reports for, while it runs. */
  attemptFor(token: string): AttemptKey | undefined {
    return this.running.attemptFor(token);
  }

  worktreePath(state: RunState, group: Group): string {
    return worktreePath(state, group);
  }

  logPath(state: RunState, group: string, seq: number): string {
    return logPath(state, group, seq);
  }

  /** Asks a cheap model for the title and the name of a run, in the background. */
  nameRun(state: RunState): Promise<void> {
    return nameRun(this.dependencies, this.running, state);
  }

  private async performOne(state: RunState, effect: Effect): Promise<void> {
    switch (effect.kind) {
      case 'start_attempt':
        return this.attempts.start(state, effect.group, effect.seq);
      case 'stop_attempt':
        return this.running.stop({ run: effect.run, group: effect.group, seq: effect.seq });
      case 'run_action':
        return this.actions.run(state, effect.group, effect.seq);
      case 'commit':
        return this.git.commit(state, effect.group, effect.stepId, effect.summary);
      case 'merge':
        return this.git.merge(state, effect.group, effect.updateOnConflict);
      case 'deliver':
        return this.git.deliver(state, effect.groups, effect.force, effect.message);
      case 'cleanup':
        return this.git.cleanup(state);
      case 'prepare_resolve':
        return this.git.prepareResolve(state, effect.groups);
      case 'finish_resolve':
        return this.git.finishResolve(state, effect.message, effect.conflicts);
    }
  }
}
