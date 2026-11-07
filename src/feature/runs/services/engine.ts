import {
  dispatch,
  planDispatch,
  transition,
  waitKey,
  type Effect,
  type Event,
} from '../machine/index.ts';
import type { ObservePort, QueueAdvancePort, RunsPublishPort } from '../ports/index.ts';
import { allGroups, limitHolds, type GroupWait, type RunState } from '../types/index.ts';

import type { RunStates } from './states.ts';

/** The longest delay `setTimeout` keeps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** What carries out the effects the machine returns: the agents, git and the delivery. */
export interface EffectRunner {
  perform(state: RunState, effects: Effect[]): Promise<void>;
  /** An agent runs: a step or the naming of a run. */
  busy(): boolean;
  /** Stops every agent and waits for them to exit. */
  stopAll(): Promise<void>;
}

export interface RunEngineDependencies {
  states: RunStates;
  now: () => number;
  /** A timer fires this long after a usage limit resets. */
  wakeMarginMs: number;
  queue: QueueAdvancePort;
  observe: ObservePort;
  publish: RunsPublishPort;
}

/**
 * The one queue every change of the daemon's state goes through, and the application of
 * `transition`: save, effects, the scheduler, the waits and the wake-up after a usage limit.
 */
export class RunEngine {
  private readonly dependencies: RunEngineDependencies;
  private queue: Promise<unknown> = Promise.resolve();
  private effects: EffectRunner | null = null;
  private halted = false;
  /** Queued groups the scheduler holds back, by `waitKey`; recomputed after each `schedule()`. */
  private waits = new Map<string, GroupWait>();
  /** Waits of each unfinished run as text, to tell subscribers when they change. */
  private readonly waitSignature = new Map<string, string>();
  private wakeTimer: NodeJS.Timeout | null = null;

  constructor(dependencies: RunEngineDependencies) {
    this.dependencies = dependencies;
  }

  /** The runner of effects; set once, right after both are built. */
  attach(effects: EffectRunner): void {
    this.effects = effects;
  }

  /** The daemon is stopping: nothing new starts. */
  get stopping(): boolean {
    return this.halted;
  }

  /** Runs `work` after everything queued before it. */
  serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async apply(state: RunState, event: Event): Promise<void> {
    const effects = transition(state, event, this.dependencies.now());
    this.save(state);
    await this.runner().perform(state, effects);
    await this.schedule();
  }

  /** Writes the run and tells the clients, the queue and the observers. */
  save(state: RunState): void {
    const { states, publish, queue, observe } = this.dependencies;
    states.write(state);
    publish.runSaved(state);
    queue.runChanged(state);
    // Any run, queued or not: an incident of a run started directly is noticed as well.
    observe.request();
  }

  async schedule(): Promise<void> {
    if (this.halted) return;
    const { states, now } = this.dependencies;
    try {
      const all = states.all();
      const active = all.filter((state) => state.run.finishedAt === null);
      // Finished runs too: a usage limit of a failed run still holds its runtime.
      const effects = dispatch(all, now());
      this.armWake();
      if (effects.length === 0) return;
      for (const state of active) this.save(state);
      for (const effect of effects) {
        const state = all.find((candidate) => candidate.run.id === effect.run);
        if (state) await this.runner().perform(state, [effect]);
      }
    } finally {
      this.refreshWaits();
    }
  }

  /** The wait of a queued group, or null when it may start. */
  readonly waitOf = (run: string, slug: string): GroupWait | null =>
    this.waits.get(waitKey(run, slug)) ?? null;

  /**
   * Sets the timer to the nearest moment a usage limit resets: a held runtime may start its
   * steps again, a queue stopped by the limit may start by itself.
   */
  armWake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.halted) return;
    const { states, now, wakeMarginMs, queue } = this.dependencies;
    const moment = now();
    const moments = [...limitHolds(states.all(), moment).values(), ...queue.wakeMoments()];
    if (moments.length === 0) return;
    const delay = Math.min(Math.max(Math.min(...moments) - moment, 0) + wakeMarginMs, MAX_TIMER_MS);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.serial(() => this.wake()).catch(() => undefined);
    }, delay);
    this.wakeTimer.unref();
  }

  /** Starts the steps whose usage limit reset and the queues that resume after it. */
  async wake(): Promise<void> {
    if (this.halted) return;
    await this.schedule();
    await this.dependencies.queue.wake();
    this.dependencies.observe.request();
    this.armWake();
  }

  /** An agent runs (a step or the naming of a run) or a group merges. */
  busy(): boolean {
    if (this.runner().busy()) return true;
    return this.dependencies.states
      .all()
      .some(
        (state) =>
          state.run.finishedAt === null && allGroups(state).some((group) => group.mergeInFlight),
      );
  }

  /** Nothing new starts from now on; the wake-up timer is dropped. */
  halt(): void {
    this.halted = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
  }

  /** Stops the agents and waits for the work already queued. */
  async drain(): Promise<void> {
    await this.runner().stopAll();
    await this.queue.catch(() => undefined);
  }

  /** Recomputes which queued groups wait, and tells subscribers about runs whose waits changed. */
  private refreshWaits(): void {
    const states = this.dependencies.states.all();
    this.waits = planDispatch(states, this.dependencies.now()).waits;
    const changed: RunState[] = [];
    const repositories = new Set<string>();
    for (const state of states) {
      const id = state.run.id;
      const prefix = `${id}/`;
      const signature =
        state.run.finishedAt === null
          ? [...this.waits]
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, wait]) => `${key}:${JSON.stringify(wait)}`)
              .sort()
              .join('|')
          : '';
      const known = this.waitSignature.get(id) ?? '';
      if (signature === known) continue;
      if (signature === '') this.waitSignature.delete(id);
      else this.waitSignature.set(id, signature);
      changed.push(state);
      repositories.add(state.run.repository);
    }
    if (changed.length > 0) this.dependencies.publish.waitsChanged(changed, repositories);
  }

  private runner(): EffectRunner {
    if (this.effects === null) throw new Error('the runner of effects is not attached');
    return this.effects;
  }
}
