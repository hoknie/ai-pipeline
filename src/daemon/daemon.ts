import { randomInt } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import {
  ConfigEditError,
  ConfigLoadError,
  type ConfigPaths,
  type EditRequest,
  commitEdit,
  draftConfig,
  editorView,
  planEdit,
  type ConfigError,
  configPaths,
  databasePath,
  findSpecialist,
  findWorkflow,
  loadConfig,
  planSettings,
  socketPath,
  workflowNameOf,
  type DeliveryMode,
} from '../config/index.ts';
import {
  Rejection,
  addItem,
  type ItemFields,
  checkSkip,
  stepStates,
  addLinkedTag,
  addTag,
  autoTagName,
  runName,
  advance,
  autopilotAnswers,
  allGroups,
  createRun,
  dependencyTags,
  checkReturnedPatch,
  checkPosition,
  checkDependencies,
  editItem,
  spreadTags,
  editTag,
  emptyQueue,
  itemFailed,
  itemStarted,
  knownTags,
  mergeTags,
  moveItem,
  pauseQueue,
  acknowledgeRun,
  adoptRun,
  problemKeys,
  retryableGroups,
  returnRun,
  pauseRun,
  claimPlace,
  canReturn,
  dismissRun,
  returnItemOf,
  queueWakeAt,
  limitHolds,
  queueItemId,
  removeItem,
  removeTag,
  keepLinkedTags,
  linkedTagOf,
  parseParentRef,
  withoutLinkedTags,
  resolveManualTags,
  resolveTags,
  setParallel,
  setQueueSettings,
  startQueue,
  dispatch,
  findGroup,
  groupRef,
  isRunFinished,
  groupsFromTask,
  runId,
  runRef,
  tagId,
  permissionsOf,
  specialistsOf,
  transition,
  workflowTopologies,
  workflowTopology,
  type Event,
  type PermissionsRefresh,
  type SpecialistsRefresh,
  type OnLimit,
  type Queue,
  type QueueItem,
  type RunState,
  type Tag,
  type GroupWait,
  planDispatch,
  waitKey,
} from '../core/index.ts';
import {
  diffStat,
  excludeWorkspace,
  git,
  prepareRunBranch,
  refExists,
  repositoryRoot,
  workspaceRoot,
  type DiffStat,
} from '../git/index.ts';
import {
  catalogView,
  currentBuild,
  groupView,
  queueView,
  repositoryViews,
  runView,
  withQueue,
  type BuildInfo,
  type PingResult,
  type RepositoryView,
  type ParamsOf,
  type Request,
  type ApplyResult,
  type RunCreated,
  type RunQueued,
  type QueueView,
  type RunView,
  type TagView,
  type Transcript,
  type ConfigEditResult,
  type ConfigPreview,
  type ConfigCatalogResponse,
  type ConfigEditorResponse,
  type WorkflowsView,
  type WebStartResult,
  type WebStatusResult,
  type BackgroundProcessesView,
  runTitle,
  type WebStopResult,
} from '../protocol/index.ts';
import { runtimeCatalog, runtimeFor } from '../runtime/index.ts';
import { Store, type KnownRepository } from '../store/index.ts';

import { Executor, NAMING_TIMEOUT_MS, USAGE_INTERVAL_MS, type AttemptKey } from './executor.ts';
import { readLines, readTail } from './logs.ts';
import { DRAIN_MS, STOP_GRACE_MS } from './supervisor.ts';
import {
  selectBackground,
  snapshotProcesses,
  KILL_GRACE_MS,
  terminateTree,
  type AgentRoot,
  type PsRow,
} from './processes.ts';

const NO_PANEL = 'this daemon serves no web panel';
/** A timer fires this long after a usage limit resets, so the reset has surely passed. */
const WAKE_MARGIN_MS = 1000;
/** The longest delay `setTimeout` keeps. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** How often the daemon looks at background processes while someone is subscribed. */
const PROCESS_STREAM_MS = 2000;
/** Pause between a SIGTERM and the extra look at background processes. */
const PROCESS_KILL_LOOK_MS = 250;

/** The web panel the daemon serves; implemented outside the daemon layer and passed in. */
export interface PanelControl {
  status(): WebStatusResult;
  start(options: { token?: string; restart?: boolean }): Promise<WebStartResult>;
  stop(): Promise<WebStopResult>;
}

/** Every duration the daemon waits for; tests shorten them. */
export interface DaemonTimings {
  /** Length of one second of a step's `timeout`. */
  timeoutUnitMs: number;
  /** How long the output of an agent is drained after it exited. */
  drainMs: number;
  /** Time between the stop signal and SIGKILL for an agent. */
  stopGraceMs: number;
  /** Time between SIGTERM and SIGKILL when a background process is killed. */
  killGraceMs: number;
  /** A timer fires this long after a usage limit resets. */
  wakeMarginMs: number;
  /** How often the usage of a running step is saved. */
  usageIntervalMs: number;
  /** The longest the naming agent may run. */
  namingTimeoutMs: number;
  /** How often subscribers get the background processes. */
  processStreamMs: number;
  /** Pause between a SIGTERM and the extra look at background processes. */
  processKillLookMs: number;
  /** How long a snapshot of the process table answers `processes` requests. */
  processCacheMs: number;
}

/** The durations of a daemon without overrides. */
export const DEFAULT_TIMINGS: DaemonTimings = {
  timeoutUnitMs: 1000,
  drainMs: DRAIN_MS,
  stopGraceMs: STOP_GRACE_MS,
  killGraceMs: KILL_GRACE_MS,
  wakeMarginMs: WAKE_MARGIN_MS,
  usageIntervalMs: USAGE_INTERVAL_MS,
  namingTimeoutMs: NAMING_TIMEOUT_MS,
  processStreamMs: PROCESS_STREAM_MS,
  processKillLookMs: PROCESS_KILL_LOOK_MS,
  processCacheMs: 1_000,
};

export interface DaemonOptions {
  stateDirectory: string;
  entry: string[];
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Time between the stop signal and SIGKILL for an agent; overrides `timings.stopGraceMs`. */
  graceMs?: number;
  /** Overrides of the durations the daemon waits for. */
  timings?: Partial<DaemonTimings>;
  /** Build the daemon reports to its clients; defaults to the build of this process. */
  build?: BuildInfo;
  /** Serves `web_status`, `web_start` and `web_stop`; without it the daemon refuses them. */
  panel?: PanelControl;
  /** How often subscribers get the background processes; defaults to 2 s. */
  processesIntervalMs?: number;
  /** Takes the process table; defaults to `ps`. */
  snapshotProcesses?: () => Promise<PsRow[]>;
  /** How often the daemon checks that its socket file is in place; defaults to 5 s. */
  socketCheckMs?: number;
}

export class Daemon {
  readonly store: Store;
  readonly socket: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly now: () => number;
  readonly build: BuildInfo;
  private readonly panel: PanelControl | undefined;
  private readonly states = new Map<string, RunState>();
  private readonly executor: Executor;
  stopping = false;
  private readonly subscribers = new Set<(line: string) => void>();
  private readonly diffs = new Map<string, DiffStat>();
  private readonly diffing = new Set<string>();
  private readonly diffAgain = new Set<string>();
  private seq = 0;
  private max = 3;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly queues = new Map<string, Queue>();
  private readonly advanceRequested = new Set<string>();
  private readonly queueRuns = new Map<string, string>();
  /** Per repository: return item of each returned run, as subscribers last saw it. */
  private readonly returnItems = new Map<string, Map<string, string>>();
  /** Queued groups the scheduler holds back, by `waitKey`; recomputed after each `schedule()`. */
  private waits = new Map<string, GroupWait>();
  /** Waits of each unfinished run as text, to tell subscribers when they change. */
  private readonly waitSignature = new Map<string, string>();
  private readonly registry = new Map<string, KnownRepository>();
  private repositoriesJson = '';
  private catalog: Tag[] = [];
  private wakeTimer: NodeJS.Timeout | null = null;
  /** Agents that exited, by PID; their process group is background while it has members. */
  private readonly departed = new Map<number, AgentRoot>();
  private psCache: { at: number; rows: PsRow[] } | null = null;
  readonly timings: DaemonTimings;
  private readonly processesIntervalMs: number;
  private readonly takeProcesses: () => Promise<PsRow[]>;
  private processTimer: NodeJS.Timeout | null = null;
  private processLooking = false;
  /** The list (JSON) subscribers last got, or null. */
  private sentProcesses: string | null = null;
  private sentProcessesError: string | null = null;

  constructor(options: DaemonOptions) {
    this.store = new Store(databasePath(options.stateDirectory));
    this.socket = socketPath(options.stateDirectory);
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? Date.now;
    this.build = options.build ?? currentBuild();
    this.panel = options.panel;
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.processesIntervalMs = options.processesIntervalMs ?? this.timings.processStreamMs;
    this.takeProcesses = options.snapshotProcesses ?? (() => snapshotProcesses());
    this.executor = new Executor({
      daemon: this,
      entry: options.entry,
      graceMs: options.graceMs ?? this.timings.stopGraceMs,
      timings: this.timings,
    });
  }

  async start(): Promise<void> {
    await this.serial(async () => {
      const recovered = this.store.recover(this.now());
      for (const { state } of recovered) this.states.set(state.run.id, state);
      // Finished runs whose usage limit may still hold a runtime.
      for (const id of this.store.limitedRunIds()) {
        if (this.states.has(id)) continue;
        const state = this.store.loadRun(id);
        if (state && limitHolds([state], this.now()).size > 0) this.states.set(id, state);
      }
      const latest = [...this.states.values()].sort((a, b) => b.run.createdAt - a.run.createdAt)[0];
      if (latest) this.max = latest.run.config.max;
      for (const queue of this.store.queues()) this.queues.set(queue.repository, queue);
      this.catalog = this.store.tags();
      for (const entry of this.store.repositories()) this.registry.set(entry.path, entry);
      // A delivery cut off by the restart starts again.
      for (const { state, effects } of recovered) await this.executor.perform(state, effects);
      await this.schedule();
      for (const queue of [...this.queues.values()]) {
        if (
          queue.status === 'running' ||
          queue.runs.length > 0 ||
          queue.skipped.length > 0 ||
          queue.stop?.kind === 'limit'
        ) {
          await this.advanceQueue(queue.repository);
        }
      }
    });
  }

  save(state: RunState): void {
    this.store.saveRun(state);
    this.broadcast(state);
    this.publishRepositories();
    const queue = this.queues.get(state.run.repository);
    if (
      queue &&
      (queue.runs.length > 0 ||
        queue.skipped.includes(state.run.id) ||
        queue.items.some((item) => item.after.includes(state.run.id)))
    ) {
      this.requestAdvance(state.run.repository);
    }
  }

  /** Looks at the queue of the repository once, however many changes arrive meanwhile. */
  private requestAdvance(repository: string): void {
    if (this.stopping || this.advanceRequested.has(repository)) return;
    this.advanceRequested.add(repository);
    void this.serial(async () => {
      this.advanceRequested.delete(repository);
      if (!this.stopping) await this.advanceQueue(repository);
    }).catch(() => undefined);
  }

  /** What a usage limit does to the groups of the repository's runs: the queue's setting. */
  onLimitOf(repository: string): OnLimit {
    return this.queueFor(repository).onLimit;
  }

  private queueFor(repository: string): Queue {
    const cached = this.queues.get(repository);
    if (cached) return cached;
    const queue =
      this.store.loadQueue(repository) ??
      emptyQueue(repository, this.now(), this.store.maxTaskNumber(repository) + 1);
    this.queues.set(repository, queue);
    return queue;
  }

  private lookupState(id: string): RunState | undefined {
    try {
      return this.state(id);
    } catch {
      return undefined;
    }
  }

  private queueSnapshot(queue: Queue): QueueView {
    const delivery = this.deliverySettings(queue.repository);
    return queueView(
      queue,
      (id) => this.lookupState(id),
      delivery.auto,
      this.catalog,
      delivery.mode,
      this.waitLookup,
      delivery.names,
    );
  }

  /** `delivery.auto`, `delivery.mode` and workflow names of the repository now; null when its configuration cannot be loaded. */
  private deliverySettings(repository: string): {
    auto: boolean | null;
    mode: DeliveryMode | null;
    names: (id: string) => string;
  } {
    try {
      const config = loadConfig(this.configPathsOf(repository));
      return {
        auto: config.delivery.auto,
        mode: config.delivery.mode,
        names: (id) => workflowNameOf(config, id),
      };
    } catch (error) {
      if (error instanceof ConfigLoadError) return { auto: null, mode: null, names: (id) => id };
      throw error;
    }
  }

  /** Configuration may change `delivery.auto`, which the queue view shows. */
  private republishQueue(repository: string): void {
    const queue = this.queues.get(repository);
    if (queue) this.publishQueue(queue);
  }

  private saveQueue(queue: Queue): QueueView {
    this.store.saveQueue(queue);
    return this.publishQueue(queue);
  }

  /** Sends the `queue` event and remembers which runs subscribers have seen. */
  private publishQueue(queue: Queue): QueueView {
    const view = this.queueSnapshot(queue);
    this.queueRuns.set(queue.repository, queueSignature(view));
    if (this.subscribers.size > 0) {
      this.seq += 1;
      const line = JSON.stringify({ event: 'queue', seq: this.seq, queue: view });
      for (const send of this.subscribers) send(line);
    }
    this.publishRepositories();
    this.publishReturned(queue);
    return view;
  }

  /** Sends a `run` event to every run whose return item appeared, changed or went away. */
  private publishReturned(queue: Queue): void {
    const before = this.returnItems.get(queue.repository) ?? new Map<string, string>();
    const after = new Map<string, string>();
    for (const item of queue.items) if (item.run !== null) after.set(item.run, item.id);
    this.returnItems.set(queue.repository, after);
    for (const run of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(run) === after.get(run)) continue;
      const state = this.lookupState(run);
      if (state) this.broadcast(state);
    }
  }

  private repositoryList(): RepositoryView[] {
    return repositoryViews(
      [...this.registry.values()],
      [...this.states.values()],
      [...this.queues.values()],
    );
  }

  /** Publishes the registry when its counters or entries differ from what subscribers last saw. */
  private publishRepositories(): void {
    if (this.subscribers.size === 0) return;
    const repositories = this.repositoryList();
    const text = JSON.stringify(repositories);
    if (text === this.repositoriesJson) return;
    this.repositoriesJson = text;
    this.seq += 1;
    const line = JSON.stringify({ event: 'repositories', seq: this.seq, repositories });
    for (const send of this.subscribers) send(line);
  }

  /** Adds a repository root to the registry; returns whether it was new. */
  private remember(root: string): void {
    if (this.registry.has(root)) return;
    const addedAt = this.now();
    this.store.addRepository(root, addedAt);
    this.registry.set(root, { path: root, addedAt });
    this.publishRepositories();
  }

  private async rootOf(path: string): Promise<string> {
    const root = await repositoryRoot(path);
    this.remember(root);
    return root;
  }

  private async repositoryRemove(path: string): Promise<RepositoryView[]> {
    let root: string;
    try {
      root = await repositoryRoot(path);
    } catch {
      root = resolve(path);
    }
    if (!this.registry.has(root)) throw new Rejection(`unknown repository ${root}`);
    const unfinished = [...this.states.values()].filter(
      (state) => state.run.repository === root && !isRunFinished(state),
    ).length;
    if (unfinished > 0) throw new Rejection(`repository has unfinished runs: ${unfinished}`);
    const queue = this.queues.get(root);
    if (queue && (queue.status === 'running' || queue.items.length > 0)) {
      throw new Rejection('repository queue is not empty or running');
    }
    this.store.removeRepository(root);
    this.registry.delete(root);
    this.publishRepositories();
    return this.repositoryList();
  }

  private async advanceQueue(repository: string): Promise<Map<string, RunCreated>> {
    const started = new Map<string, RunCreated>();
    const queue = this.queueFor(repository);
    const fingerprint = () => JSON.stringify({ ...queue, updatedAt: 0 });
    const before = fingerprint();
    const states = queue.runs.flatMap((id) => {
      const state = this.lookupState(id);
      return state ? [state] : [];
    });
    const { take, freeze } = advance(queue, states, (id) => this.lookupState(id), this.now());
    let changed = fingerprint() !== before;
    for (const id of freeze) await this.freezeRun(id);
    const current = queue.runs.flatMap((id) => this.lookupState(id) ?? []);
    for (const answer of autopilotAnswers(queue, current)) {
      const state = this.lookupState(answer.run);
      if (!state) continue;
      try {
        await this.apply(state, {
          kind: 'answer',
          group: answer.group,
          answer: answer.answer,
          by: 'autopilot',
          permissions: this.currentPermissions(state),
        });
      } catch (error) {
        if (!(error instanceof Rejection)) throw error;
      }
    }
    let failed = false;
    for (const item of take) {
      try {
        if (item.run !== null) {
          await this.takeReturned(queue, item);
          this.store.saveQueue(queue);
          changed = true;
          continue;
        }
        const created = await this.createRun(
          itemParams(queue, item),
          knownTags(this.catalog, item.tags),
          item,
        );
        itemStarted(queue, item.id, created.runId, this.now());
        started.set(item.id, created);
        this.store.saveQueue(queue);
      } catch (error) {
        itemFailed(queue, item.id, (error as Error).message, this.now());
        changed = true;
        if (!queue.skipFailed) break;
        failed = true;
        continue;
      }
      changed = true;
    }
    if (changed) this.saveQueue(queue);
    else if (this.queueRuns.get(repository) !== queueSignature(this.queueSnapshot(queue))) {
      this.publishQueue(queue);
    }
    if ((take.length > 0 && queue.runs.length > 0) || (failed && queue.status === 'running')) {
      this.requestAdvance(repository);
    }
    this.armWake();
    return started;
  }

  /** Sets `hold: frozen` on a run the queue has taken off its places for a priority run. */
  private async freezeRun(id: string): Promise<void> {
    const state = this.lookupState(id);
    if (!state) return;
    try {
      await this.apply(state, { kind: 'hold', hold: 'frozen' });
    } catch (error) {
      if (!(error instanceof Rejection)) throw error;
    }
  }

  /** A priority action: the run takes a place, and the last run that took one may be frozen. */
  private async claimPlaceFor(queue: Queue, run: string): Promise<void> {
    const now = this.now();
    const states = queue.runs.flatMap((id) => this.lookupState(id) ?? []);
    const frozen = claimPlace(queue, states, run, queueItemId(now, randomInt(36 ** 3)), now);
    if (frozen !== null) await this.freezeRun(frozen);
  }

  /**
   * Takes a returned run: retries its failed and cancelled groups, and the run holds a place in
   * the queue instead of the item.
   */
  private async takeReturned(queue: Queue, item: QueueItem): Promise<RunCreated> {
    const id = item.run as string;
    const state = this.lookupState(id);
    if (!state) throw new Rejection(`unknown run \`${id}\``);
    const held = state.run.hold !== null;
    if (held) await this.apply(state, { kind: 'hold', hold: null });
    const groups = retryableGroups(state);
    if (groups.length === 0 && !held) {
      throw new Rejection('run has no failed or cancelled groups');
    }
    for (const group of groups) {
      await this.apply(state, {
        kind: 'retry',
        group,
        permissions: this.currentPermissions(state),
      });
    }
    acknowledgeRun(queue, state);
    itemStarted(queue, item.id, id, this.now());
    return {
      runId: id,
      number: state.run.number,
      branch: state.run.branch,
      groups: state.groups.map((group) => ({ slug: group.slug, title: group.title })),
      split: state.split !== null,
      warnings: [],
    };
  }

  /** `queue_return`: the run goes back to the queue as its first item. */
  private returnToQueue(params: ParamsOf<'queue_return'>): Promise<unknown> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      if (params.repository !== undefined) {
        const root = await this.rootOf(params.repository);
        if (root !== state.run.repository) {
          throw new Rejection('run belongs to another repository');
        }
      }
      const queue = this.queueFor(state.run.repository);
      const now = this.now();
      const item = returnRun(queue, state, queueItemId(now, randomInt(36 ** 3)), now);
      this.saveQueue(queue);
      await this.advanceQueue(state.run.repository);
      return { ...this.queueSnapshot(queue), item: item.id };
    });
  }

  /**
   * `run_pause`: the run keeps `hold: paused`, starts no new step, and becomes the last item of
   * the queue; the step in progress finishes.
   */
  private pauseRunRequest(params: ParamsOf<'run_pause'>): Promise<unknown> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      if (params.repository !== undefined) {
        const root = await this.rootOf(params.repository);
        if (root !== state.run.repository) {
          throw new Rejection('run belongs to another repository');
        }
      }
      const queue = this.queueFor(state.run.repository);
      const now = this.now();
      const item = pauseRun(queue, state, queueItemId(now, randomInt(36 ** 3)), now);
      await this.apply(state, { kind: 'hold', hold: 'paused' });
      this.saveQueue(queue);
      await this.advanceQueue(state.run.repository);
      return { ...this.queueSnapshot(queue), item: item.id };
    });
  }

  /** `queue_dismiss`: a skipped run leaves the skipped list. */
  private dismissFromQueue(params: ParamsOf<'queue_dismiss'>): Promise<unknown> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      if (params.repository !== undefined) {
        const root = await this.rootOf(params.repository);
        if (root !== state.run.repository) {
          throw new Rejection('run belongs to another repository');
        }
      }
      const queue = this.queueFor(state.run.repository);
      dismissRun(queue, state, this.now());
      this.saveQueue(queue);
      await this.advanceQueue(state.run.repository);
      return this.queueSnapshot(queue);
    });
  }

  /** Rejects an unknown workflow or a `skip` that does not fit it. */
  private async ensureItem(
    repository: string,
    workflow: string,
    skip: readonly string[] = [],
  ): Promise<void> {
    const config = loadConfig(
      configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME),
    );
    if (!findWorkflow(config, workflow)) {
      const known = config.workflows.map((candidate) => candidate.id).join(', ') || 'none';
      throw new Rejection(`unknown workflow \`${workflow}\`; known: ${known}`);
    }
    const error = checkSkip(config, workflow, skip);
    if (error !== null) throw new Rejection(error);
  }

  private queueRequest(
    request: Exclude<
      Extract<Request, { method: `queue${string}` }>,
      { method: 'queue_return' | 'queue_dismiss' }
    >,
  ): Promise<unknown> {
    return this.serial(async () => {
      const repository = await this.rootOf(request.params.repository);
      const queue = this.queueFor(repository);
      const now = this.now();
      switch (request.method) {
        case 'queue':
          return this.queueSnapshot(queue);
        case 'queue_add':
          return this.addQueueItem(repository, request.params);
        case 'queue_edit': {
          const {
            item,
            workflow,
            task,
            groups,
            title,
            position,
            autoDeliver,
            deliveryMode,
            postponed,
          } = request.params;
          let skip = request.params.skip;
          const returned = queue.items.find((candidate) => candidate.id === item);
          const parentParam = request.params.parent;
          if (returned?.run && parentParam !== undefined) {
            throw new Rejection('a returned run keeps its own task');
          }
          const parentState =
            parentParam === undefined || parentParam === null
              ? null
              : this.resolveParent(repository, parentParam);
          if (returned?.run && skip !== undefined) {
            // A returned run has no item-level skip: the steps are skipped in the run itself.
            checkReturnedPatch(
              {
                workflow,
                task,
                groups,
                title,
                tags: request.params.tags,
                autoDeliver,
                deliveryMode,
                postponed,
                skip,
              },
              true,
            );
            const state = this.lookupState(returned.run);
            if (!state) throw new Rejection(`unknown run \`${returned.run}\``);
            const wanted = new Set(skip);
            const current = new Set(state.run.skippedSteps);
            const skipError = checkSkip(state.run.config, state.run.workflow, [...wanted]);
            if (skipError !== null) throw new Rejection(skipError);
            const changes = [
              ...[...current].filter((step) => !wanted.has(step)).map((step) => [step, false]),
              ...[...wanted].filter((step) => !current.has(step)).map((step) => [step, true]),
            ] as [string, boolean][];
            for (const [step] of changes) {
              if (stepStates(state).find((entry) => entry.id === step)?.state === 'done') {
                throw new Rejection(`step \`${step}\` is already passed by every group`);
              }
            }
            if (position !== undefined) checkPosition(queue, position);
            if (request.params.after !== undefined) {
              checkDependencies(queue, item, [
                ...new Set(this.resolveDependencies(queue, request.params.after)),
              ]);
            }
            for (const [step, on] of changes) {
              await this.apply(state, { kind: 'step_skip', step, skip: on });
            }
            skip = undefined;
          }
          if (workflow !== undefined || skip !== undefined) {
            const current = queue.items.find((candidate) => candidate.id === item);
            if (current) {
              await this.ensureItem(repository, workflow ?? current.workflow, skip ?? current.skip);
            }
          }
          const after =
            request.params.after === undefined
              ? undefined
              : this.resolveDependencies(queue, request.params.after);
          let tags =
            request.params.tags === undefined
              ? undefined
              : resolveManualTags(this.catalog, request.params.tags);
          const existing = queue.items.find((candidate) => candidate.id === item);
          const before = existing?.tags ?? [];
          if (existing && tags !== undefined) {
            tags = keepLinkedTags(this.catalog, knownTags(this.catalog, existing.tags), tags);
          }
          const parentPending = existing !== undefined && parentParam !== undefined;
          const patch = {
            workflow,
            task,
            groups,
            title,
            position,
            autoDeliver,
            deliveryMode,
            skip,
            after,
            postponed,
          };
          // Every check of the edit runs on a copy before the tag of the parent is created.
          if (existing && parentState) editItem(structuredClone(queue), item, patch, now);
          if (existing && parentPending) {
            const parentTag = parentState ? await this.linkedTagFor(parentState) : null;
            const rest = withoutLinkedTags(this.catalog, tags ?? existing.tags);
            tags = mergeTags(parentTag ? [parentTag.id] : [], rest);
          }
          if (existing && after !== undefined) {
            const fresh = after.filter((ref) => !existing.after.includes(ref));
            const inherited = knownTags(
              this.catalog,
              dependencyTags(queue, fresh, (id) => this.lookupState(id)?.run.tags),
            );
            if (inherited.length > 0) tags = mergeTags(tags ?? existing.tags, inherited);
          }
          editItem(queue, item, { ...patch, tags }, now);
          const edited = queue.items.find((candidate) => candidate.id === item);
          if (edited) {
            spreadTags(
              queue,
              item,
              edited.tags.filter((id) => !before.includes(id)),
              now,
            );
          }
          this.saveQueue(queue);
          await this.advanceQueue(repository);
          return this.queueSnapshot(queue);
        }
        case 'queue_remove': {
          const removed = queue.items.find((candidate) => candidate.id === request.params.item);
          removeItem(queue, request.params.item, now, (id) => this.lookupState(id));
          const held = removed?.run ? this.lookupState(removed.run) : undefined;
          if (held && held.run.hold !== null) await this.apply(held, { kind: 'hold', hold: null });
          return this.saveQueue(queue);
        }
        case 'queue_start': {
          if (request.params.parallel !== undefined) {
            setParallel(queue, request.params.parallel, now);
          }
          startQueue(
            queue,
            queue.runs.flatMap((id) => this.lookupState(id) ?? []),
            now,
          );
          this.saveQueue(queue);
          await this.advanceQueue(repository);
          return this.queueSnapshot(queue);
        }
        case 'queue_pause':
          pauseQueue(queue, now);
          return this.saveQueue(queue);
        case 'queue_settings': {
          const { parallel, autopilot, autoAnswer, skipFailed, autopilotAnswer } = request.params;
          const onLimit = request.params.onLimit as OnLimit | undefined;
          const enablesAutopilot = autopilot === true && !queue.autopilot;
          setQueueSettings(
            queue,
            { parallel, autopilot, autoAnswer, skipFailed, autopilotAnswer, onLimit },
            now,
          );
          if (enablesAutopilot && queue.status === 'stopped' && queue.stop === null) {
            startQueue(
              queue,
              queue.runs.flatMap((id) => this.lookupState(id) ?? []),
              now,
            );
          }
          this.saveQueue(queue);
          await this.advanceQueue(repository);
          return this.queueSnapshot(queue);
        }
        case 'queue_run_now': {
          const item = queue.items.find((candidate) => candidate.id === request.params.item);
          if (!item) throw new Rejection('unknown queue item');
          if (item.run !== null) {
            const target = this.lookupState(item.run);
            if (!target) throw new Rejection(`unknown run \`${item.run}\``);
            if (target.run.hold === null && retryableGroups(target).length === 0) {
              throw new Rejection('run has no failed or cancelled groups');
            }
            await this.claimPlaceFor(queue, item.run);
            const resumed = await this.takeReturned(queue, item);
            this.saveQueue(queue);
            return resumed;
          }
          const created = await this.createRun(
            itemParams(queue, item),
            knownTags(this.catalog, item.tags),
            item,
          );
          await this.claimPlaceFor(queue, created.runId);
          itemStarted(queue, item.id, created.runId, this.now());
          this.saveQueue(queue);
          return created;
        }
      }
    });
  }

  private broadcast(state: RunState): void {
    if (this.subscribers.size === 0) return;
    this.seq += 1;
    const line = JSON.stringify({ event: 'run', seq: this.seq, run: this.view(state) });
    for (const send of this.subscribers) send(line);
  }

  private view(state: RunState, now = this.now()): RunView {
    this.ensureDiffs(state);
    const view = runView(
      state,
      now,
      (slug) => this.diffs.get(`${state.run.id}/${slug}`) ?? null,
      this.catalog,
      this.waitLookup,
    );
    const queue = this.queues.get(state.run.repository);
    const item = queue ? returnItemOf(queue, state.run.id) : null;
    return withQueue({ ...view, returnable: this.returnable(state) }, item?.id ?? null);
  }

  /** Whether `queue_return` would take the run: something to retry, and not in its queue yet. */
  private returnable(state: RunState): boolean {
    const queue = this.queues.get(state.run.repository);
    if (!queue) return retryableGroups(state).length > 0;
    return canReturn(queue, state);
  }

  /** Computes missing diff statistics of a run in the background, then publishes them. */
  private ensureDiffs(state: RunState): void {
    for (const group of state.groups) {
      const key = `${state.run.id}/${group.slug}`;
      if (group.attempts.length === 0 || this.diffs.has(key) || this.diffing.has(key)) continue;
      void this.refreshDiff(state, group.slug);
    }
  }

  async refreshDiff(state: RunState, slug: string): Promise<void> {
    const key = `${state.run.id}/${slug}`;
    const group = findGroup(state, slug);
    if (!group) return;
    if (this.diffing.has(key)) {
      this.diffAgain.add(key);
      return;
    }
    this.diffing.add(key);
    try {
      const { repository } = state.run;
      let range: [string, string] | null = null;
      if (group.status === 'merged' && group.mergeCommit) {
        range = [`${group.mergeCommit}^1`, group.mergeCommit];
      } else {
        const ref = groupRef(state.run, slug);
        const run = runRef(state.run);
        if ((await refExists(repository, ref)) && (await refExists(repository, run))) {
          range = [await git(repository, 'merge-base', run, ref), ref];
        }
      }
      if (range === null) return;
      this.diffs.set(key, await diffStat(repository, range[0], range[1]));
      this.broadcast(state);
    } catch {
      // the commits are gone (for example after git gc); leave the statistics unknown
    } finally {
      this.diffing.delete(key);
      if (this.diffAgain.delete(key)) void this.refreshDiff(state, slug);
    }
  }

  subscribe(send: (line: string) => void): () => void {
    this.seq += 1;
    const runs = this.store
      .recentRuns()
      .map((stored) => this.view(this.states.get(stored.run.id) ?? stored));
    const queues = [...this.queues.values()]
      .filter(
        (queue) =>
          queue.items.length > 0 ||
          queue.status === 'running' ||
          queue.runs.length > 0 ||
          queue.stop !== null,
      )
      .map((queue) => this.queueSnapshot(queue));
    const repositories = this.repositoryList();
    this.repositoriesJson = JSON.stringify(repositories);
    send(
      JSON.stringify({
        event: 'snapshot',
        seq: this.seq,
        runs,
        queues,
        repositories,
        tags: catalogView(this.catalog),
      }),
    );
    if (this.sentProcesses !== null) {
      this.seq += 1;
      send(
        JSON.stringify({
          event: 'processes',
          seq: this.seq,
          processes: JSON.parse(this.sentProcesses) as unknown[],
        }),
      );
    }
    this.subscribers.add(send);
    this.watchProcesses();
    return () => {
      this.subscribers.delete(send);
      if (this.subscribers.size === 0) this.unwatchProcesses();
    };
  }

  private watchProcesses(): void {
    if (this.processTimer || this.stopping) return;
    this.processTimer = setInterval(() => void this.lookAtProcesses(), this.processesIntervalMs);
    this.processTimer.unref();
    void this.lookAtProcesses();
  }

  private unwatchProcesses(): void {
    if (this.processTimer) clearInterval(this.processTimer);
    this.processTimer = null;
    this.sentProcesses = null;
    this.sentProcessesError = null;
  }

  /** One look at background processes; tells subscribers when the list or the error changed. */
  private async lookAtProcesses(fresh = false): Promise<void> {
    if (this.processLooking || this.stopping || this.subscribers.size === 0) return;
    if (
      !fresh &&
      this.executor.agentRoots().length === 0 &&
      this.departed.size === 0 &&
      this.sentProcesses === '[]'
    ) {
      return;
    }
    this.processLooking = true;
    try {
      const { processes } = await this.processList(fresh);
      const json = JSON.stringify(processes);
      this.sentProcessesError = null;
      if (json === this.sentProcesses || this.subscribers.size === 0) return;
      this.sentProcesses = json;
      this.publishProcesses({ processes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === this.sentProcessesError || this.subscribers.size === 0) return;
      this.sentProcessesError = message;
      this.sentProcesses = null;
      this.publishProcesses({ error: message });
    } finally {
      this.processLooking = false;
    }
  }

  private publishProcesses(payload: { processes: unknown[] } | { error: string }): void {
    this.seq += 1;
    const line = JSON.stringify({ event: 'processes', seq: this.seq, ...payload });
    for (const send of this.subscribers) send(line);
  }

  /**
   * Sets the timer to the nearest moment a usage limit resets: a held runtime may start its
   * steps again, a queue stopped by the limit may start by itself.
   */
  private armWake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.stopping) return;
    const now = this.now();
    const moments = [
      ...limitHolds(this.states.values(), now).values(),
      ...[...this.queues.values()].flatMap((queue) => queueWakeAt(queue) ?? []),
    ];
    if (moments.length === 0) return;
    const delay = Math.min(
      Math.max(Math.min(...moments) - now, 0) + this.timings.wakeMarginMs,
      MAX_TIMER_MS,
    );
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.serial(() => this.wake()).catch(() => undefined);
    }, delay);
    this.wakeTimer.unref();
  }

  /** Starts the steps whose usage limit reset and the queues that resume after it. */
  async wake(): Promise<void> {
    if (this.stopping) return;
    await this.schedule();
    for (const queue of [...this.queues.values()]) {
      if (queue.stop?.kind === 'limit') await this.advanceQueue(queue.repository);
    }
    this.armWake();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    if (this.processTimer) clearInterval(this.processTimer);
    this.processTimer = null;
    await this.executor.stopAll();
    await this.queue.catch(() => undefined);
    this.store.close();
  }

  /** An agent exited; what it left in its process group is still shown as background. */
  agentGone(root: AgentRoot): void {
    this.departed.set(root.pid, root);
  }

  private async processRows(fresh: boolean): Promise<PsRow[]> {
    const now = Date.now();
    if (!fresh && this.psCache && now - this.psCache.at < this.timings.processCacheMs)
      return this.psCache.rows;
    const rows = await this.takeProcesses();
    this.psCache = { at: now, rows };
    return rows;
  }

  private async backgroundProcesses(fresh: boolean) {
    const rows = await this.processRows(fresh);
    for (const pid of [...this.departed.keys()]) {
      if (!rows.some((row) => row.pgid === pid)) this.departed.delete(pid);
    }
    const roots = [...this.executor.agentRoots(), ...this.departed.values()];
    return { rows, found: selectBackground(rows, roots) };
  }

  private async processList(fresh = false): Promise<BackgroundProcessesView> {
    const { found } = await this.backgroundProcesses(fresh);
    return {
      processes: found.map(({ root, ...process }) => {
        let state: RunState | null = null;
        try {
          state = this.state(root.run);
        } catch {
          state = null;
        }
        const group = state && root.group !== null ? findGroup(state, root.group) : null;
        const attempt = group?.attempts.find((candidate) => candidate.seq === root.seq);
        return {
          ...process,
          owner: {
            runId: root.run,
            runTitle: state ? runTitle(state) : root.run,
            repository: state?.run.repository ?? '',
            group: root.group,
            groupTitle: group?.title ?? null,
            step: attempt?.stepId ?? null,
          },
        };
      }),
    };
  }

  private async processKill(pid: number): Promise<{ ok: true }> {
    const { rows, found } = await this.backgroundProcesses(true);
    if (!found.some((process) => process.pid === pid)) {
      throw new Rejection(`not a background process: ${pid}`);
    }
    const look = (): void => void this.lookAtProcesses(true);
    setTimeout(look, this.timings.processKillLookMs).unref();
    void terminateTree(pid, {
      rows,
      stillBackground: async () =>
        new Set((await this.backgroundProcesses(true)).found.map((process) => process.pid)),
      graceMs: this.timings.killGraceMs,
    })
      .catch(() => undefined)
      .then(look);
    return { ok: true };
  }

  /** An agent runs (a step or the naming of a run) or a group merges. */
  busy(): boolean {
    if (this.executor.busy()) return true;
    for (const state of this.states.values()) {
      if (state.run.finishedAt !== null) continue;
      if (allGroups(state).some((group) => group.mergeInFlight)) return true;
    }
    return false;
  }

  serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  state(runIdentifier: string): RunState {
    const cached = this.states.get(runIdentifier);
    if (cached) return cached;
    const loaded = this.store.loadRun(runIdentifier);
    if (!loaded) throw new Rejection(`unknown run \`${runIdentifier}\``);
    this.states.set(runIdentifier, loaded);
    return loaded;
  }

  async apply(state: RunState, event: Event): Promise<void> {
    const effects = transition(state, event, this.now());
    this.save(state);
    await this.executor.perform(state, effects);
    await this.schedule();
  }

  async schedule(): Promise<void> {
    if (this.stopping) return;
    try {
      const active = [...this.states.values()].filter((state) => state.run.finishedAt === null);
      // Finished runs too: a usage limit of a failed run still holds its runtime.
      const effects = dispatch([...this.states.values()], this.max, this.now());
      this.armWake();
      if (effects.length === 0) return;
      for (const state of active) this.save(state);
      for (const effect of effects) {
        const state = this.states.get(effect.run);
        if (state) await this.executor.perform(state, [effect]);
      }
    } finally {
      this.refreshWaits();
    }
  }

  /** Recomputes which queued groups wait, and tells subscribers about runs whose waits changed. */
  private refreshWaits(): void {
    const states = [...this.states.values()];
    this.waits = planDispatch(states, this.max, this.now()).waits;
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
      this.broadcast(state);
      repositories.add(state.run.repository);
    }
    for (const repository of repositories) {
      const queue = this.queues.get(repository);
      if (queue && this.queueRuns.get(repository) !== queueSignature(this.queueSnapshot(queue))) {
        this.publishQueue(queue);
      }
    }
  }

  private waitLookup = (run: string, slug: string): GroupWait | null =>
    this.waits.get(waitKey(run, slug)) ?? null;

  handle(request: Request): Promise<unknown> {
    switch (request.method) {
      case 'ping':
        return Promise.resolve({
          pong: true,
          pid: process.pid,
          build: this.build,
          busy: this.busy(),
        } satisfies PingResult);
      case 'shutdown':
        return Promise.resolve({ stopping: true });
      case 'shutdown_idle':
        // After the work already queued, so the check and the stop are one step.
        return this.serial(() => {
          if (this.stopping || this.busy()) return Promise.resolve({ stopping: false });
          // Stopping now keeps the scheduler from starting an agent before the daemon closes.
          this.stopping = true;
          return Promise.resolve({ stopping: true });
        });
      case 'subscribe':
        return Promise.reject(new Rejection('subscribe is served on its own connection'));
      case 'processes':
        return this.processList();
      case 'process_kill':
        return this.processKill(request.params.pid);
      case 'web_status':
        return Promise.resolve(
          this.panel?.status() ?? {
            running: false,
            host: null,
            port: null,
            auth: null,
            url: null,
            reason: NO_PANEL,
            stopped: false,
          },
        );
      case 'web_start':
        return this.panel
          ? this.panel.start(request.params)
          : Promise.reject(new Rejection(NO_PANEL));
      case 'web_stop':
        return this.panel ? this.panel.stop() : Promise.reject(new Rejection(NO_PANEL));
      case 'repositories':
        return Promise.resolve(this.repositoryList());
      case 'repository_add':
        return this.serial(async () => {
          await this.rootOf(request.params.path);
          return this.repositoryList();
        });
      case 'repository_remove':
        return this.serial(() => this.repositoryRemove(request.params.path));
      case 'run':
        return this.serial(() => this.enqueueRun(request.params));
      case 'status':
        return Promise.resolve(this.status(request.params.runId));
      case 'group':
        return Promise.resolve(this.group(request.params));
      case 'transcript':
        return Promise.resolve(this.transcript(request.params));
      case 'workflows':
        return this.workflows(request.params.repository);
      case 'config':
        return this.configView(request.params.repository);
      case 'config_catalog':
        return this.configCatalog(request.params.repository);
      case 'config_write':
        return this.configEdit(request.params.repository, {
          kind: request.params.kind,
          id: request.params.id,
          value: request.params.value,
          revision: request.params.revision,
          level: request.params.level ?? 'project',
        });
      case 'config_setting':
        return this.configSetting(request.params);
      case 'config_settings':
        return this.configSettings(request.params);
      case 'config_preview':
        return this.configPreview(request.params);
      case 'config_delete':
        return this.configEdit(request.params.repository, {
          kind: request.params.kind,
          id: request.params.id,
          value: null,
          revision: request.params.revision,
          level: request.params.level ?? 'project',
        });
      case 'cancel':
        return this.event(request.params.runId, {
          kind: 'cancel',
          group: request.params.group ?? null,
        });
      case 'retry':
        return this.retryGroup(request.params);
      case 'run_skip':
        return this.event(request.params.runId, {
          kind: 'step_skip',
          step: request.params.step,
          skip: request.params.skip,
        });
      case 'answer': {
        const { runId: id, group, answer } = request.params;
        return this.event(id, (state) => ({
          kind: 'answer',
          group,
          answer,
          permissions: this.currentPermissions(state),
        }));
      }
      case 'report':
        return this.workerEvent(request.params.token, (key) => ({
          kind: 'report',
          group: key.group,
          seq: key.seq,
          report: {
            verdict: request.params.verdict,
            summary: request.params.summary,
            feedback: request.params.feedback ?? null,
            questions: request.params.questions ?? null,
          },
        }));
      case 'split':
        return this.workerEvent(request.params.token, (key) => ({
          kind: 'split_proposed',
          seq: key.seq,
          groups: request.params.groups,
        }));
      case 'apply':
        return this.deliver(request.params);
      case 'tags':
        return Promise.resolve(catalogView(this.catalog));
      case 'tag_add':
        return this.serial(() => Promise.resolve(this.tagAdd(request.params)));
      case 'tag_edit':
        return this.serial(() => Promise.resolve(this.tagEdit(request.params)));
      case 'tag_remove':
        return this.serial(() => this.tagRemove(request.params.tag));
      case 'run_tags':
        return this.serial(() => this.runTags(request.params));
      case 'worker_queue_add':
        return this.workerQueueAdd(request.params);
      case 'queue':
      case 'queue_add':
      case 'queue_edit':
      case 'queue_remove':
      case 'queue_start':
      case 'queue_pause':
      case 'queue_settings':
      case 'queue_run_now':
        return this.queueRequest(request);
      case 'queue_return':
        return this.returnToQueue(request.params);
      case 'queue_dismiss':
        return this.dismissFromQueue(request.params);
      case 'run_pause':
        return this.pauseRunRequest(request.params);
    }
  }

  private event(
    runIdentifier: string,
    event: Event | ((state: RunState) => Event),
  ): Promise<unknown> {
    return this.serial(async () => {
      const state = this.state(runIdentifier);
      await this.apply(state, typeof event === 'function' ? event(state) : event);
      return this.view(state);
    });
  }

  /** A direct retry works at once, and the revived run holds a place in the queue. */
  private retryGroup(params: ParamsOf<'retry'>): Promise<unknown> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      const keys = problemKeys(state);
      // Loaded before the event: a broken configuration refuses the retry with nothing changed.
      const refresh =
        params.refreshConfig === true
          ? { specialists: this.currentSpecialists(state) }
          : { permissions: this.currentPermissions(state) };
      // A rejected retry leaves the hold in place; the hold is released only after it succeeds.
      await this.apply(state, { kind: 'retry', group: params.group, ...refresh });
      if (state.run.hold !== null) await this.apply(state, { kind: 'hold', hold: null });
      const queue = this.queueFor(state.run.repository);
      const now = this.now();
      const adopted = adoptRun(queue, state, keys, now, {
        states: queue.runs.flatMap((id) => this.lookupState(id) ?? []),
        itemId: queueItemId(now, randomInt(36 ** 3)),
      });
      if (adopted) {
        if (adopted.frozen !== null) await this.freezeRun(adopted.frozen);
        this.saveQueue(queue);
        this.requestAdvance(state.run.repository);
      }
      return this.view(state);
    });
  }

  private deliver(params: ParamsOf<'apply'>): Promise<ApplyResult> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      const requested = params.groups ?? null;
      const files = await this.executor.changedFiles(state, requested);
      const before = new Set(
        state.groups
          .filter((group) => group.delivery.state === 'applied')
          .map((group) => group.slug),
      );
      await this.apply(state, {
        kind: 'deliver_requested',
        groups: requested,
        force: params.force ?? false,
        files,
      });
      return {
        runId: state.run.id,
        pending: state.run.pendingDelivery !== null,
        groups: state.groups
          .filter((group) =>
            requested && requested.length > 0
              ? requested.includes(group.slug)
              : group.status === 'merged' && !before.has(group.slug),
          )
          .map((group) => ({ slug: group.slug, delivery: group.delivery })),
      };
    });
  }

  private publishTags(): TagView[] {
    const tags = catalogView(this.catalog);
    if (this.subscribers.size > 0) {
      this.seq += 1;
      const line = JSON.stringify({ event: 'tags', seq: this.seq, tags });
      for (const send of this.subscribers) send(line);
    }
    return tags;
  }

  private createTag(input: {
    name: string;
    color?: string | undefined;
    task?: { run: string; number: number } | undefined;
  }): Tag {
    const now = this.now();
    let id = tagId(now, randomInt(36 ** 3));
    while (this.catalog.some((tag) => tag.id === id)) id = tagId(now, randomInt(36 ** 3));
    const tag = input.task
      ? addLinkedTag(this.catalog, { name: input.name, task: input.task }, id, now)
      : addTag(this.catalog, input, id, now);
    this.store.saveTag(tag);
    this.catalog = [...this.catalog, tag];
    return tag;
  }

  private tagAdd(params: ParamsOf<'tag_add'>): TagView[] {
    this.createTag(params);
    return this.publishTags();
  }

  private tagEdit(params: ParamsOf<'tag_edit'>): TagView[] {
    const tag = editTag(this.catalog, params.tag, params);
    this.store.saveTag(tag);
    this.catalog = this.catalog.map((candidate) => (candidate.id === tag.id ? tag : candidate));
    return this.publishTags();
  }

  /** Takes the tag off every run and queue item, in memory and in the store, then publishes. */
  private async tagRemove(name: string): Promise<TagView[]> {
    const { id } = removeTag(this.catalog, name);
    this.store.removeTag(id);
    this.catalog = this.catalog.filter((tag) => tag.id !== id);
    for (const state of [...this.states.values()]) {
      if (state.run.tags.includes(id)) {
        await this.apply(state, {
          kind: 'tags_set',
          tags: state.run.tags.filter((tag) => tag !== id),
        });
      }
    }
    for (const queue of this.queues.values()) {
      if (!queue.items.some((item) => item.tags.includes(id))) continue;
      for (const item of queue.items) item.tags = item.tags.filter((tag) => tag !== id);
      queue.updatedAt = this.now();
      this.saveQueue(queue);
    }
    return this.publishTags();
  }

  /** Own tags plus the tags of the predecessors in `after`, only those still in the catalog. */
  private inheritTags(queue: Queue, own: string[], after: string[]): string[] {
    const inherited = dependencyTags(queue, after, (id) => this.lookupState(id)?.run.tags);
    return knownTags(this.catalog, mergeTags(own, inherited));
  }

  private async runTags(params: ParamsOf<'run_tags'>): Promise<RunView> {
    const state = this.state(params.runId);
    const add = resolveManualTags(this.catalog, params.add ?? []);
    const remove = new Set(resolveTags(this.catalog, params.remove ?? []));
    const current = knownTags(this.catalog, state.run.tags).filter((id) => !remove.has(id));
    const tags = [...current, ...add.filter((id) => !current.includes(id) && !remove.has(id))];
    await this.apply(state, { kind: 'tags_set', tags });
    const added = tags.filter((id) => !current.includes(id));
    if (added.length > 0) {
      const queue = this.queueFor(state.run.repository);
      if (spreadTags(queue, state.run.id, added, this.now()).length > 0) this.saveQueue(queue);
    }
    return this.view(state);
  }

  /** `run`: the task goes to the end of the queue, a stopped queue is started, then the queue advances. */
  private async enqueueRun(params: ParamsOf<'run'>): Promise<RunQueued> {
    const repository = await this.rootOf(params.repository);
    const queue = this.queueFor(repository);
    const now = this.now();
    const { workflow, task, groups, title, autoDeliver, deliveryMode, skip } = params;
    await this.ensureItem(repository, workflow, skip);
    const after = this.resolveDependencies(queue, params.after ?? []);
    const manual = resolveManualTags(this.catalog, params.tags ?? []);
    const parent =
      params.parent === undefined ? null : this.resolveParent(repository, params.parent);
    if (parent) {
      this.checkNewItem(
        queue,
        { workflow, task, groups, title, autoDeliver, deliveryMode, skip, after },
        now,
      );
    }
    const parentTag = parent ? await this.linkedTagFor(parent) : null;
    const tags = this.inheritTags(queue, mergeTags(parentTag ? [parentTag.id] : [], manual), after);
    const item = addItem(
      queue,
      { workflow, task, groups, title, autoDeliver, deliveryMode, tags, skip, after },
      queueItemId(now, randomInt(36 ** 3)),
      now,
    );
    if (queue.status === 'stopped') {
      startQueue(
        queue,
        queue.runs.flatMap((id) => this.lookupState(id) ?? []),
        now,
      );
    }
    this.saveQueue(queue);
    const started = await this.advanceQueue(repository);
    const run = started.get(item.id) ?? null;
    if (!run && queue.stop?.kind === 'item' && queue.stop.item === item.id) {
      throw new Rejection(queue.stop.error);
    }
    return { item: item.id, number: item.number, run, queue: this.queueSnapshot(queue) };
  }

  private async addQueueItem(
    repository: string,
    params: Pick<
      ParamsOf<'queue_add'>,
      | 'workflow'
      | 'task'
      | 'groups'
      | 'title'
      | 'autoDeliver'
      | 'deliveryMode'
      | 'skip'
      | 'after'
      | 'postponed'
    > &
      Pick<ParamsOf<'queue_add'>, 'tags' | 'parent'>,
    inherited?: string[],
  ): Promise<unknown> {
    const { workflow, task, groups, title, autoDeliver, deliveryMode, skip, postponed } = params;
    const queue = this.queueFor(repository);
    const now = this.now();
    await this.ensureItem(repository, workflow, skip);
    const after = this.resolveDependencies(queue, params.after ?? []);
    let own = inherited ?? resolveManualTags(this.catalog, params.tags ?? []);
    if (params.parent !== undefined) {
      const parent = this.resolveParent(repository, params.parent);
      this.checkNewItem(
        queue,
        { workflow, task, groups, title, autoDeliver, deliveryMode, skip, after, postponed },
        now,
      );
      own = mergeTags([(await this.linkedTagFor(parent)).id], own);
    }
    const tags = this.inheritTags(queue, own, after);
    const item = addItem(
      queue,
      { workflow, task, groups, title, autoDeliver, deliveryMode, tags, skip, after, postponed },
      queueItemId(now, randomInt(36 ** 3)),
      now,
    );
    this.saveQueue(queue);
    await this.advanceQueue(repository);
    return { ...this.queueSnapshot(queue), item: item.id };
  }

  /** Runs the checks of `addItem` on a copy of the queue: nothing changes. */
  private checkNewItem(queue: Queue, fields: ItemFields, now: number): void {
    addItem(structuredClone(queue), fields, queueItemId(now, 0), now);
  }

  /** The run a `parent` refers to: a run id first, then a task number of the repository. */
  private resolveParent(repository: string, ref: string | number): RunState {
    const parsed = parseParentRef(ref);
    if (parsed.id !== null) {
      const state = this.lookupState(parsed.id);
      if (state) return state;
    }
    if (parsed.number !== null) {
      const id = this.store.runIdByNumber(repository, parsed.number);
      const state = id === null ? undefined : this.lookupState(id);
      if (state) return state;
    }
    throw new Rejection(`unknown parent \`${ref}\``);
  }

  /**
   * The linked task tag of the run: the existing one or a new one named after the run.
   * The tag goes to the run itself too (first), and to the items that wait for it.
   */
  private async linkedTagFor(state: RunState): Promise<Tag> {
    const run = state.run;
    let tag = linkedTagOf(this.catalog, run.id);
    if (!tag) {
      const base = run.name ?? (run.title ? runName(run.title) : run.id);
      tag = this.createTag({
        name: autoTagName(this.catalog, base),
        task: { run: run.id, number: run.number },
      });
      this.publishTags();
    }
    const own = knownTags(this.catalog, run.tags);
    if (!own.includes(tag.id)) {
      await this.apply(state, { kind: 'tags_set', tags: [tag.id, ...own] });
      const queue = this.queueFor(run.repository);
      if (spreadTags(queue, run.id, [tag.id], this.now()).length > 0) this.saveQueue(queue);
    }
    return tag;
  }

  /** A task from a specialist with `queue: true` goes to the queue of the repository of its run. */
  private workerQueueAdd(params: ParamsOf<'worker_queue_add'>): Promise<unknown> {
    return this.serial(async () => {
      const key = this.executor.attemptFor(params.token);
      if (!key) throw new Rejection('unknown or expired report token');
      const state = this.state(key.run);
      const attempt = state.groups
        .find((group) => group.slug === key.group)
        ?.attempts.find((candidate) => candidate.seq === key.seq);
      if (!attempt || attempt.status !== 'running') {
        throw new Rejection('unknown or expired report token');
      }
      if (findSpecialist(state.run.config, attempt.specialist)?.queue !== true) {
        throw new Rejection(`specialist \`${attempt.specialist}\` may not add tasks to the queue`);
      }
      // Every task carries the linked task tag of its run, then the other tags of the run.
      const repository = state.run.repository;
      await this.ensureItem(repository, params.workflow, params.skip);
      const queue = this.queueFor(repository);
      const after = this.resolveDependencies(queue, params.after ?? []);
      const { workflow, task, groups, title, autoDeliver, deliveryMode, skip } = params;
      this.checkNewItem(
        queue,
        { workflow, task, groups, title, autoDeliver, deliveryMode, skip, after },
        this.now(),
      );
      const tag = await this.linkedTagFor(state);
      return this.addQueueItem(
        repository,
        params,
        mergeTags([tag.id], knownTags(this.catalog, state.run.tags)),
      );
    });
  }

  private workerEvent(token: string, build: (key: AttemptKey) => Event): Promise<unknown> {
    return this.serial(async () => {
      const key = this.executor.attemptFor(token);
      if (!key) throw new Rejection('unknown or expired report token');
      await this.apply(this.state(key.run), build(key));
      return { recorded: true };
    });
  }

  /**
   * Turns the ids a task waits for into ids of queue items or runs of the repository.
   * An item that already became a run is replaced by that run.
   */
  private resolveDependencies(queue: Queue, ids: string[]): string[] {
    return [...new Set(ids)].map((id) => {
      if (queue.items.some((item) => item.id === id)) return id;
      const own = this.lookupState(id);
      if (own?.run.repository === queue.repository) return id;
      const started = this.store.runOfQueueItem(queue.repository, id);
      if (started) return started.run.id;
      throw new Rejection(`unknown dependency \`${id}\``);
    });
  }

  private async createRun(
    params: ParamsOf<'run'>,
    tagIds: string[],
    queueItem: { id: string; number: number },
  ): Promise<RunCreated> {
    const repository = await this.rootOf(params.repository);
    const config = loadConfig(
      configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME),
    );
    if (!findWorkflow(config, params.workflow)) {
      const known = config.workflows.map((workflow) => workflow.id).join(', ') || 'none';
      throw new Rejection(`unknown workflow \`${params.workflow}\`; known: ${known}`);
    }
    const skipError = checkSkip(config, params.workflow, params.skip ?? []);
    if (skipError !== null) throw new Rejection(skipError);
    const id = runId(this.now(), randomInt(36 ** 4));
    const prepared = await prepareRunBranch(repository, `refs/aip/${id}/run`, {
      workingTree: config.workspace.base === 'working_tree',
      include: config.workspace.include,
      snapshotRef: `refs/aip/${id}/base`,
    });
    await excludeWorkspace(repository, workspaceRoot(repository, config.workspaceDir));
    const fromTask = params.task !== undefined;
    const state = createRun({
      id,
      repository,
      workflow: params.workflow,
      baseCommit: prepared.baseCommit,
      config,
      dirtyWarning: prepared.dirty,
      groups: params.groups ?? groupsFromTask(params.task ?? ''),
      split: fromTask,
      fromQueue: true,
      queueItem: queueItem.id,
      number: queueItem.number,
      autoDeliver: params.autoDeliver,
      deliveryMode: params.deliveryMode,
      skip: params.skip,
      tags: tagIds,
      now: this.now(),
      ...(params.title ? { title: params.title } : {}),
    });
    this.states.set(id, state);
    this.max = config.max;
    this.save(state);
    await this.schedule();
    if (state.run.title === null && config.naming.enabled) void this.executor.nameRun(state);
    const warnings = prepared.dirty
      ? ['the repository has uncommitted changes; they are not part of this run']
      : [];
    return {
      runId: id,
      number: state.run.number,
      branch: state.run.branch,
      groups: state.groups.map((group) => ({ slug: group.slug, title: group.title })),
      split: state.split !== null,
      warnings,
    };
  }

  private status(runIdentifier: string | undefined): unknown {
    const now = this.now();
    if (runIdentifier) return this.view(this.state(runIdentifier), now);
    return this.store
      .recentRuns()
      .map((stored) => this.view(this.states.get(stored.run.id) ?? stored, now));
  }

  /**
   * Whole specialists of the current configuration of the run's repository; a configuration that
   * does not load or pass validation refuses the request.
   */
  private currentSpecialists(state: RunState): SpecialistsRefresh {
    try {
      return specialistsOf(loadConfig(this.configPathsOf(state.run.repository)));
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw new Rejection((error as Error).message);
      const { detail } = error;
      const first = detail.kind === 'invalid' ? detail.errors[0] : undefined;
      throw new Rejection(
        `configuration not loaded: ${first ? `${first.path}: ${first.message}` : error.message}`,
      );
    }
  }

  /** Permissions of the specialists in the current configuration of the run's repository. */
  private currentPermissions(state: RunState): PermissionsRefresh {
    try {
      const paths = configPaths(
        state.run.repository,
        this.environment.XDG_CONFIG_HOME,
        this.environment.HOME,
      );
      return permissionsOf(loadConfig(paths));
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) return { error: (error as Error).message };
      const { detail } = error;
      const first = detail.kind === 'invalid' ? detail.errors[0] : undefined;
      return { error: first ? `${first.path}: ${first.message}` : error.message };
    }
  }

  private async configView(path: string): Promise<ConfigEditorResponse> {
    const repository = await this.rootOf(path);
    return { repository, ...editorView(this.configPathsOf(repository)) };
  }

  private async configCatalog(path: string): Promise<ConfigCatalogResponse> {
    const repository = await this.rootOf(path);
    const home = this.environment.HOME || homedir();
    let mcpInherited = false;
    try {
      mcpInherited = loadConfig(this.configPathsOf(repository)).claude.mcp === 'inherit';
    } catch {
      mcpInherited = false;
    }
    return {
      repository,
      mcpInherited,
      runtimes: runtimeCatalog(repository, home, this.environment),
    };
  }

  /** Check and write run without an await between them, so two edits never interleave. */
  private async configEdit(path: string, edit: EditRequest): Promise<ConfigEditResult> {
    const repository = await this.rootOf(path);
    const paths = this.configPathsOf(repository);
    let plan;
    try {
      plan = planEdit(paths, edit);
    } catch (error) {
      if (error instanceof ConfigEditError) throw new Rejection(error.message);
      throw error;
    }
    if (!plan.ok) return plan;
    const result = { ok: true as const, ...commitEdit(plan) };
    this.republishQueue(repository);
    return result;
  }

  private async configSetting(params: ParamsOf<'config_setting'>): Promise<ConfigEditResult> {
    return this.configSettings({
      repository: params.repository,
      values: { [params.path]: params.value },
      revision: params.revision,
      level: params.level,
    });
  }

  private async configSettings(params: ParamsOf<'config_settings'>): Promise<ConfigEditResult> {
    const repository = await this.rootOf(params.repository);
    let plan;
    try {
      plan = planSettings(this.configPathsOf(repository), {
        values: params.values,
        revision: params.revision,
        level: params.level,
      });
    } catch (error) {
      if (error instanceof ConfigEditError) throw new Rejection(error.message);
      throw error;
    }
    if (!plan.ok) return plan;
    const result = { ok: true as const, ...commitEdit(plan) };
    this.republishQueue(repository);
    return result;
  }

  private async configPreview(params: ParamsOf<'config_preview'>): Promise<ConfigPreview> {
    const repository = await this.rootOf(params.repository);
    const { config, errors } = draftConfig(this.configPathsOf(repository), {
      kind: params.kind,
      id: params.id,
      value: params.value,
      level: params.level ?? 'project',
    });
    return { topology: config ? workflowTopology(config, params.id) : null, errors };
  }

  private configPathsOf(repository: string): ConfigPaths {
    return configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME);
  }

  private async workflows(path: string): Promise<WorkflowsView> {
    const repository = await this.rootOf(path);
    try {
      const config = loadConfig(
        configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME),
      );
      return { repository, workflows: workflowTopologies(config), errors: [] };
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      const { detail } = error;
      const errors =
        detail.kind === 'invalid'
          ? detail.errors
          : [{ path: describePath(detail), message: error.message }];
      return { repository, workflows: [], errors };
    }
  }

  private transcript(params: ParamsOf<'transcript'>): Transcript {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw new Rejection(`unknown group \`${params.group}\` in run ${params.runId}`);
    const attempt =
      params.seq === undefined
        ? group.attempts.at(-1)
        : group.attempts.find((candidate) => candidate.seq === params.seq);
    if (params.seq !== undefined && !attempt) {
      throw new Rejection(`unknown attempt ${params.seq} of group \`${params.group}\``);
    }
    const base = { runId: state.run.id, group: group.slug };
    if (!attempt) return { ...base, seq: null, cursor: 0, running: false, entries: [] };
    const { lines, cursor } = readLines(
      this.executor.logPath(state, group.slug, attempt.seq),
      params.after ?? 0,
    );
    const entries = runtimeFor(attempt.runtime, this.environment).transcript(lines);
    const verdict = attempt.report?.verdict ?? null;
    for (const entry of entries) if (entry.kind === 'result') entry.verdict = verdict;
    return { ...base, seq: attempt.seq, cursor, running: attempt.status === 'running', entries };
  }

  private group(params: ParamsOf<'group'>): unknown {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw new Rejection(`unknown group \`${params.group}\` in run ${params.runId}`);
    const last = group.attempts.at(-1);
    const log = last
      ? {
          seq: last.seq,
          lines: readTail(
            this.executor.logPath(state, group.slug, last.seq),
            params.tailLines ?? 40,
          ),
        }
      : null;
    this.ensureDiffs(state);
    return groupView(
      state,
      group,
      this.executor.worktreePath(state, group),
      log,
      this.now(),
      this.diffs.get(`${state.run.id}/${group.slug}`) ?? null,
      this.waitLookup,
    );
  }
}

/** The arguments of `run` that an item of the queue stands for. */
function itemParams(queue: Queue, item: QueueItem): ParamsOf<'run'> {
  return {
    repository: queue.repository,
    workflow: item.workflow,
    ...(item.task !== null ? { task: item.task } : {}),
    ...(item.groups !== null ? { groups: item.groups } : {}),
    ...(item.title !== null ? { title: item.title } : {}),
    ...(item.autoDeliver !== null ? { autoDeliver: item.autoDeliver } : {}),
    ...(item.deliveryMode !== null ? { deliveryMode: item.deliveryMode } : {}),
    ...(item.skip.length > 0 ? { skip: item.skip } : {}),
  };
}

/** The file or directory a non-validation load error is about. */
function describePath(detail: ConfigError): string {
  switch (detail.kind) {
    case 'read':
    case 'syntax':
      return detail.path;
    case 'legacy':
      return detail.found;
    case 'no_files':
      return detail.expected[0] ?? '';
    case 'invalid':
      return '';
  }
}

/** What subscribers of the `queue` event see: runs that occupy places and readiness of the items. */
function queueSignature(view: QueueView): string {
  return JSON.stringify({
    runs: view.runs,
    skipped: view.skipped,
    autoDeliver: view.autoDeliver,
    deliveryMode: view.deliveryMode,
    items: view.items.map((item) => [item.id, item.readiness, item.after, item.postponed]),
  });
}
