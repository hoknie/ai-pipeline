import { isRejected, rejected } from '../../../platform/errors/index.ts';
import type { QueueServices } from '../../queue/services/index.ts';
import type { RegistryService } from '../../repos/services/index.ts';
import { currentPermissions, type RunsServices } from '../../runs/services/index.ts';
import {
  REPAIR_GROUP,
  findGroup,
  isServiceGroup,
  isSplitGroup,
  limitHolds,
  type Group,
  type RunState,
} from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import { validateObserverProfile } from '../../swarm-config/services/index.ts';
import type { FieldError } from '../../swarm-config/types/index.ts';
import type { ObserversPublishPort } from '../ports/index.ts';
import type { ObserverRepository } from '../repositories/index.ts';
import {
  defaultObserverSettings,
  personQuestions,
  planRepairs,
  repairAdmitted,
  repairIncidents,
  type ObserverSettings,
  type RepairAction,
  waitsForPerson,
} from '../types/index.ts';

import { checkObserverSettings } from './settings-check.ts';

export interface ObserverDependencies {
  observers: ObserverRepository;
  runs: Pick<RunsServices, 'states' | 'engine' | 'effects'>;
  queue: Pick<QueueServices, 'advance' | 'control'>;
  registry: RegistryService;
  config: ConfigService;
  now: () => number;
  publish: ObserversPublishPort;
}

/** The observers: they take the incidents of runs and repair them like a person would. */
export class ObserverService {
  private readonly dependencies: ObserverDependencies;
  private current: ObserverSettings = defaultObserverSettings();
  private requested = false;
  /** Incidents subscribers were told about, as `<run>:<incident key>`. */
  private readonly sent = new Set<string>();

  constructor(dependencies: ObserverDependencies) {
    this.dependencies = dependencies;
  }

  /** Reads the settings from the database; called once at the start. */
  load(): void {
    this.current = this.dependencies.observers.loadObservers();
  }

  settings(): ObserverSettings {
    return this.current;
  }

  /** Whether an observer takes the incident of the run: then the queue does not stop for it. */
  takesIncident(state: RunState): boolean {
    return repairAdmitted(state, this.current) && repairIncidents(state).length > 0;
  }

  /** Looks at the incidents of the runs once, however many changes arrive meanwhile. */
  request(): void {
    const { engine } = this.dependencies.runs;
    if (engine.stopping || this.requested) return;
    this.requested = true;
    void engine
      .serial(async () => {
        this.requested = false;
        if (!engine.stopping) await this.observe();
      })
      .catch(() => undefined);
  }

  /**
   * Tells subscribers about new incidents and lets observers take the oldest ones. Runs of a
   * repository with a queue look pending are left for after it: the autopilot answers first.
   * `full` also looks at the recent finished runs, which the daemon does not keep in memory.
   */
  async observe(full = false): Promise<void> {
    const { runs, queue, publish, now } = this.dependencies;
    if (runs.engine.stopping) return;
    const settings = this.current;
    const pool = new Map<string, RunState>();
    if (full) {
      // Through `get`, so the run lives in memory and `apply` changes the one that is kept.
      for (const stored of runs.states.recent()) {
        pool.set(stored.run.id, runs.states.get(stored.run.id));
      }
    }
    for (const state of runs.states.all()) pool.set(state.run.id, state);
    const all = [...pool.values()];
    const pending = (state: RunState) => queue.advance.pending(state.run.repository);
    for (const state of all.filter((candidate) => !pending(candidate))) {
      for (const incident of repairIncidents(state)) {
        const key = `${state.run.id}:${incident.key}`;
        if (this.sent.has(key)) continue;
        this.sent.add(key);
        publish.incident(state, incident);
      }
    }
    const profile = validateObserverProfile(settings.specialist);
    const specialist = profile.errors.length === 0 ? profile.specialist : null;
    if (specialist) {
      // Over all runs, so the repairs of the waiting repositories count against the workers.
      const holds = limitHolds(all, now());
      for (const { state, incident } of planRepairs(settings, all, holds)) {
        if (pending(state)) continue;
        try {
          await runs.engine.apply(state, { kind: 'repair_start', incident, specialist });
        } catch (error) {
          if (!isRejected(error)) throw error;
        }
      }
    }
    publish.observersChanged();
  }

  /** `observers_set`: new settings replace the old ones only when every value is right. */
  async set(
    value: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; errors: FieldError[] }> {
    const { observers, registry, runs, publish } = this.dependencies;
    const checked = checkObserverSettings(value, this.current, new Set(registry.paths()));
    if (checked.settings === null) return { ok: false, errors: checked.errors };
    this.current = checked.settings;
    observers.saveObservers(this.current);
    // The state `repair` of every run depends on the settings: send the runs again.
    for (const state of runs.states.all()) publish.runChanged(state);
    await this.observe(true);
    publish.observersChanged();
    return { ok: true };
  }

  /** A repository left the registry: the observers no longer work there, or work at `to`. */
  forgetRepository(root: string, to?: string): void {
    if (!this.current.projects.some((project) => project.repository === root)) return;
    this.current = {
      ...this.current,
      projects:
        to === undefined
          ? this.current.projects.filter((project) => project.repository !== root)
          : this.current.projects.map((project) =>
              project.repository === root ? { ...project, repository: to } : project,
            ),
    };
    this.dependencies.observers.saveObservers(this.current);
    this.dependencies.publish.observersChanged();
  }

  /** An action of an observer: only on its own run, by the rules of a person. */
  repairAction(params: RepairAction): Promise<{ recorded: true }> {
    const { runs } = this.dependencies;
    return runs.engine.serial(async () => {
      const key = runs.effects.attemptFor(params.token);
      if (!key || key.group !== REPAIR_GROUP) throw rejected('unknown or expired report token');
      const state = runs.states.get(key.run);
      const attempt = state.repair?.attempts.find((candidate) => candidate.seq === key.seq);
      if (!attempt || attempt.status !== 'running') {
        throw rejected('unknown or expired report token');
      }
      await this.act(state, params);
      return { recorded: true as const };
    });
  }

  private async act(state: RunState, params: RepairAction): Promise<void> {
    const { runs, queue, config } = this.dependencies;
    switch (params.action) {
      case 'answer': {
        const group = this.target(state, params.group);
        if (group.humanOnly !== null) {
          throw rejected(`the question of group \`${group.slug}\` is for a person only`);
        }
        const permissions = currentPermissions(config, state);
        const answer = { group: group.slug, answer: params.answer, by: 'observer' as const };
        await runs.engine.apply(state, { kind: 'answer', ...answer, permissions });
        return;
      }
      case 'retry': {
        const group = this.target(state, params.group);
        if (group.status === 'cancelled') {
          throw rejected(`group \`${group.slug}\` was cancelled; observers do not restart it`);
        }
        await queue.control.retryNow(state, {
          group: group.slug,
          refreshConfig: params.refreshConfig,
          by: 'observer',
        });
        return;
      }
      case 'cancel': {
        const group = params.group === undefined ? null : this.target(state, params.group);
        if (group !== null && waitsForPerson(group)) {
          throw rejected(
            `group \`${group.slug}\` waits for a person: its question is for a person only`,
          );
        }
        if (group === null) {
          const [asking] = personQuestions(state);
          if (asking) {
            throw rejected(
              `task ${state.run.id} has a question for a person only in group \`${asking.slug}\`; observers do not cancel it`,
            );
          }
        }
        const reason = params.reason;
        await runs.engine.apply(state, { kind: 'cancel', group: group?.slug ?? null, reason });
        return;
      }
    }
  }

  /** A group the observer may touch: any but a service group other than the split. */
  private target(state: RunState, slug: string): Group {
    const group = findGroup(state, slug);
    if (!group) throw rejected(`unknown group \`${slug}\` in run ${state.run.id}`);
    if (isServiceGroup(group) && !isSplitGroup(group)) {
      throw rejected(`group \`${slug}\` is a service group; observers do not touch it`);
    }
    return group;
  }
}
