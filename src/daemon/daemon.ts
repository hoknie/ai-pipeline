import { randomInt, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

import {
  ConfigEditError,
  type EditRequest,
  type EntryReference,
  type TagPlan,
} from '../feature/swarm-edit/types/index.ts';
import {
  ConfigLoadError,
  type ConfigPaths,
  type ConfigError,
  findSpecialist,
  findPipeline,
  type FieldError,
  pipelineNameOf,
  type DeliveryMode,
} from '../feature/swarm-config/types/index.ts';
import {
  commitEdit,
  commitEdits,
  tagFolder,
  planImport,
  planTagRemove,
  planTagRename,
  planTagsSet,
  draftConfig,
  editorView,
  planEdit,
  planSettings,
  sharedSpecialistUsage,
  sharedPipelineUsage,
} from '../feature/swarm-edit/services/index.ts';
import {
  configPaths,
  loadConfig,
  validateObserverProfile,
} from '../feature/swarm-config/services/index.ts';
import {
  type ItemFields,
  type Queue,
  type QueueItem,
  addItem,
  advance,
  autopilotAnswers,
  dependencyTags,
  checkReturnedPatch,
  checkPosition,
  checkDependencies,
  editItem,
  spreadTags,
  emptyQueue,
  itemFailed,
  itemStarted,
  pauseQueue,
  acknowledgeRun,
  adoptRun,
  problemKeys,
  returnRun,
  pauseRun,
  claimPlace,
  canReturn,
  dismissRun,
  returnItemOf,
  queueWakeAt,
  queueItemId,
  removeItem,
  setParallel,
  setQueueSettings,
  startQueue,
} from '../feature/queue/types/index.ts';
import {
  type OnLimit,
  type Group,
  type RunState,
  type GroupWait,
  checkSkip,
  stepStates,
  runName,
  allGroups,
  createRun,
  retryableGroups,
  limitHolds,
  findGroup,
  attemptStepLabel,
  groupRef,
  isRunFinished,
  groupsFromTask,
  runId,
  runRef,
  pipelineTopologies,
  pipelineTopology,
  specialistName,
  splitInstructionText,
  MESSAGE_INSTRUCTIONS,
  RESOLVE_INSTRUCTIONS,
  isServiceGroup,
  isSplitGroup,
  REPAIR_GROUP,
} from '../feature/runs/types/index.ts';
import {
  type Tag,
  addLinkedTag,
  tagsOfRepository,
  addTag,
  autoTagName,
  editTag,
  knownTags,
  mergeTags,
  removeTag,
  keepLinkedTags,
  linkedTagOf,
  parseParentRef,
  withoutLinkedTags,
  resolveManualTags,
  resolveTags,
  tagId,
} from '../feature/tags/types/index.ts';
import {
  type Event,
  dispatch,
  transition,
  planDispatch,
  waitKey,
} from '../feature/runs/machine/index.ts';
import {
  ARTIFACTS_PER_GROUP,
  ARTIFACT_FILE_LIMIT,
  artifactPreview,
  artifactTitle,
} from '../feature/artifacts/types/index.ts';
import {
  type PermissionsRefresh,
  type SpecialistsRefresh,
  permissionsOf,
  specialistsOf,
} from '../feature/agents/types/index.ts';
import {
  type ObserverSettings,
  defaultObserverSettings,
  planRepairs,
  repairAdmitted,
  repairIncidents,
} from '../feature/observers/types/index.ts';
import {
  changedPathsBetween,
  changedPathsSince,
  readFileAt,
  diffStat,
  excludeWorkspace,
  fileDiff,
  git,
  prepareRunBranch,
  rangePatch,
  refExists,
  repositoryRoot,
  workspaceRoot,
} from '../platform/git/index.ts';
import {
  catalogView,
  observersView,
  groupView,
  pickSpecChange,
  queueView,
  repositoryViews,
  runView,
  withQueue,
} from '../presentation/ipc/views/index.ts';
import { currentBuild, type BuildInfo } from '../platform/build/index.ts';
import type {
  GroupSpecView,
  PingResult,
  RepositoryView,
  ParamsOf,
  Request,
  ApplyResult,
  RunCreated,
  RunQueued,
  QueueView,
  RunView,
  TagView,
  Transcript,
  TranscriptEntry,
  ConfigEditResult,
  SpecialistTagFolderView,
  SpecialistTagsResult,
  SpecialistTagsView,
  SharedSpecialistsView,
  SpecialistsImportResult,
  SharedPipelinesView,
  PipelinesImportResult,
  ConfigPreview,
  ConfigCatalogResponse,
  ConfigEditorResponse,
  PipelinesView,
  SystemStagesView,
  SystemStageView,
  SystemStageSetting,
  StagePerformer,
  WebStartResult,
  WebStatusResult,
  BackgroundProcessesView,
  WebStopResult,
  FileDiffView,
  ArtifactContentView,
  ArtifactView,
  RunPatchView,
  DiffStat,
  ObserversView,
  PanelControl,
} from '../presentation/ipc/contract/index.ts';
import { runTitle } from '../feature/runs/types/index.ts';
import { runtimeCatalog, runtimeFor } from '../runtime/index.ts';
import type { Database } from '../platform/sqlite/index.ts';
import {
  artifactStorageFor,
  type ArtifactStorage,
} from '../feature/artifacts/repositories/index.ts';
import { storageFor, type PatchStorage } from '../feature/delivery/repositories/index.ts';
import type { KnownRepository } from '../feature/repos/repositories/index.ts';
import { recoverRuns } from '../feature/runs/services/index.ts';

import type { Executor, AttemptKey } from './executor.ts';
import type { ExecutorHost } from './ports.ts';
import type { DaemonRepositories } from './repositories.ts';
import type { DaemonTimings } from './timings.ts';
import { readLines, readTail, readTimes, timesPath } from './logs.ts';
import { checkObserverSettings } from './observers.ts';
import { selectBackground, terminateTree, type AgentRoot } from './processes.ts';
import { isRejected, rejected } from '../platform/errors/index.ts';
import { snapshotProcesses, type PsRow } from '../platform/process/index.ts';

const NO_PANEL = 'this daemon serves no web panel';
/** The longest delay `setTimeout` keeps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

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

/** The delivery of a group without the commit message, which only the actions after delivery need. */
function deliveryOutcome(delivery: Group['delivery']): Group['delivery'] {
  const { message: _message, ...rest } = delivery;
  return rest;
}

/** What `createApplication` builds and hands to the daemon. */
export interface DaemonParts {
  database: Database;
  repositories: DaemonRepositories;
  socket: string;
  environment: NodeJS.ProcessEnv;
  /** Defaults merged with the overrides. */
  timings: DaemonTimings;
  patchStorages: PatchStorage[];
  artifactStorages: ArtifactStorage[];
  /** Builds the executor that works for this daemon. */
  createExecutor: (host: ExecutorHost) => Executor;
}

export class Daemon implements ExecutorHost {
  readonly database: Database;
  readonly repositories: DaemonRepositories;
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
  private readonly patchStorages: PatchStorage[];
  private readonly artifactStorages: ArtifactStorage[];
  private readonly patching = new Map<string, Promise<void>>();
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly queues = new Map<string, Queue>();
  private readonly advanceRequested = new Set<string>();
  private observers: ObserverSettings = defaultObserverSettings();
  private observeRequested = false;
  /** Incidents subscribers were told about, as `<run>:<incident key>`. */
  private readonly incidentsSent = new Set<string>();
  private observersJson = '';
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

  constructor(options: DaemonOptions, parts: DaemonParts) {
    this.database = parts.database;
    this.repositories = parts.repositories;
    this.socket = parts.socket;
    this.patchStorages = parts.patchStorages;
    this.artifactStorages = parts.artifactStorages;
    this.environment = parts.environment;
    this.now = options.now ?? Date.now;
    this.build = options.build ?? currentBuild();
    this.panel = options.panel;
    this.timings = parts.timings;
    this.processesIntervalMs = options.processesIntervalMs ?? this.timings.processStreamMs;
    this.takeProcesses = options.snapshotProcesses ?? (() => snapshotProcesses());
    this.executor = parts.createExecutor(this);
  }

  async start(): Promise<void> {
    await this.sweepPatches();
    await this.sweepArtifacts();
    await this.serial(async () => {
      const recovered = recoverRuns(this.database, this.repositories.runs, this.now());
      for (const { state } of recovered) this.states.set(state.run.id, state);
      // Finished runs whose usage limit may still hold a runtime.
      for (const id of this.repositories.runs.limitedRunIds()) {
        if (this.states.has(id)) continue;
        const state = this.repositories.runs.loadRun(id);
        if (state && limitHolds([state], this.now()).size > 0) this.states.set(id, state);
      }
      const { queues, tags, known, observers } = this.repositories;
      for (const queue of queues.queues()) this.queues.set(queue.repository, queue);
      this.catalog = tags.tags();
      for (const entry of known.repositories()) this.registry.set(entry.path, entry);
      this.observers = observers.loadObservers();
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
      // Incidents from before the start, in finished runs too.
      await this.observe(true);
    });
  }

  save(state: RunState): void {
    this.repositories.runs.saveRun(state);
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
    // Any run, queued or not: an incident of a run started directly is noticed as well.
    this.requestObserve();
  }

  /** Looks at the incidents of the runs once, however many changes arrive meanwhile. */
  private requestObserve(): void {
    if (this.stopping || this.observeRequested) return;
    this.observeRequested = true;
    void this.serial(async () => {
      this.observeRequested = false;
      if (!this.stopping) await this.observe();
    }).catch(() => undefined);
  }

  /**
   * Tells subscribers about new incidents and lets observers take the oldest ones. Runs of a
   * repository with a queue look pending are left for after it: the autopilot answers first.
   * `full` also looks at the recent finished runs, which the daemon does not keep in memory.
   */
  private async observe(full = false): Promise<void> {
    if (this.stopping) return;
    const settings = this.observers;
    const pool = new Map<string, RunState>();
    if (full) {
      for (const stored of this.repositories.finished.recentRuns()) {
        if (this.states.has(stored.run.id)) continue;
        // Through `state`, so the run lives in memory and `apply` changes the one that is kept.
        pool.set(stored.run.id, this.state(stored.run.id));
      }
    }
    for (const state of this.states.values()) pool.set(state.run.id, state);
    const all = [...pool.values()];
    const states = all.filter((state) => !this.advanceRequested.has(state.run.repository));
    for (const state of states) {
      for (const incident of repairIncidents(state, settings)) {
        const key = `${state.run.id}:${incident.key}`;
        if (this.incidentsSent.has(key)) continue;
        this.incidentsSent.add(key);
        if (this.subscribers.size === 0) continue;
        this.seq += 1;
        const line = JSON.stringify({
          event: 'incident',
          seq: this.seq,
          runId: state.run.id,
          repository: state.run.repository,
          incident,
        });
        for (const send of this.subscribers) send(line);
      }
    }
    const profile = validateObserverProfile(settings.specialist);
    const specialist = profile.errors.length === 0 ? profile.specialist : null;
    if (specialist) {
      // Over all runs, so the repairs of the waiting repositories count against the workers.
      const holds = limitHolds(all, this.now());
      for (const { state, incident } of planRepairs(settings, all, holds)) {
        if (this.advanceRequested.has(state.run.repository)) continue;
        try {
          await this.apply(state, { kind: 'repair_start', incident, specialist });
        } catch (error) {
          if (!isRejected(error)) throw error;
        }
      }
    }
    this.publishObservers();
  }

  /** The observers as the settings page shows them. */
  private observersSnapshot(): ObserversView {
    return observersView(this.observers, [...this.states.values()]);
  }

  private publishObservers(): void {
    if (this.subscribers.size === 0) return;
    const view = this.observersSnapshot();
    const text = JSON.stringify(view);
    if (text === this.observersJson) return;
    this.observersJson = text;
    this.seq += 1;
    const line = JSON.stringify({ event: 'observers', seq: this.seq, observers: view });
    for (const send of this.subscribers) send(line);
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
    const { runs, queues } = this.repositories;
    const next = Math.max(runs.maxNumber(repository), queues.maxItemNumber(repository)) + 1;
    const queue = queues.loadQueue(repository) ?? emptyQueue(repository, this.now(), next);
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
      this.catalogOf(queue.repository),
      delivery.mode,
      this.waitLookup,
      delivery.names,
    );
  }

  /** `delivery.auto`, `delivery.mode` and pipeline names of the repository now; null when its configuration cannot be loaded. */
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
        names: (id) => pipelineNameOf(config, id),
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
    this.repositories.queues.saveQueue(queue);
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
      this.environment.HOME || homedir(),
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
    this.repositories.known.addRepository(root, addedAt);
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
    if (!this.registry.has(root)) throw rejected(`unknown repository ${root}`);
    const unfinished = [...this.states.values()].filter(
      (state) => state.run.repository === root && !isRunFinished(state),
    ).length;
    if (unfinished > 0) throw rejected(`repository has unfinished runs: ${unfinished}`);
    const queue = this.queues.get(root);
    if (queue && (queue.status === 'running' || queue.items.length > 0)) {
      throw rejected('repository queue is not empty or running');
    }
    this.repositories.known.removeRepository(root);
    this.registry.delete(root);
    if (this.observers.projects.some((project) => project.repository === root)) {
      this.observers = {
        ...this.observers,
        projects: this.observers.projects.filter((project) => project.repository !== root),
      };
      this.repositories.observers.saveObservers(this.observers);
      this.publishObservers();
    }
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
    // An incident an observer takes does not stop the queue.
    for (const state of states) {
      if (
        repairAdmitted(state, this.observers) &&
        repairIncidents(state, this.observers).length > 0
      ) {
        acknowledgeRun(queue, state);
      }
    }
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
        if (!isRejected(error)) throw error;
      }
    }
    let failed = false;
    for (const item of take) {
      try {
        if (item.run !== null) {
          await this.takeReturned(queue, item);
          this.repositories.queues.saveQueue(queue);
          changed = true;
          continue;
        }
        const created = await this.createRun(
          itemParams(queue, item),
          knownTags(this.catalogOf(queue.repository), item.tags),
          item,
        );
        itemStarted(queue, item.id, created.runId, this.now());
        started.set(item.id, created);
        this.repositories.queues.saveQueue(queue);
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
    // After the autopilot: the incidents it did not answer are the observers'.
    this.requestObserve();
    return started;
  }

  /** Sets `hold: frozen` on a run the queue has taken off its places for a priority run. */
  private async freezeRun(id: string): Promise<void> {
    const state = this.lookupState(id);
    if (!state) return;
    try {
      await this.apply(state, { kind: 'hold', hold: 'frozen' });
    } catch (error) {
      if (!isRejected(error)) throw error;
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
    if (!state) throw rejected(`unknown run \`${id}\``);
    const held = state.run.hold !== null;
    if (held) await this.apply(state, { kind: 'hold', hold: null });
    const groups = retryableGroups(state);
    if (groups.length === 0 && !held) {
      throw rejected('run has no failed or cancelled groups');
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
          throw rejected('run belongs to another repository');
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
   * `run_pause`: the run keeps `hold: paused` and becomes the last item of the queue; the running
   * agents are stopped by the `hold` event, and after run-now the step continues in the same session.
   */
  private pauseRunRequest(params: ParamsOf<'run_pause'>): Promise<unknown> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      if (params.repository !== undefined) {
        const root = await this.rootOf(params.repository);
        if (root !== state.run.repository) {
          throw rejected('run belongs to another repository');
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
          throw rejected('run belongs to another repository');
        }
      }
      const queue = this.queueFor(state.run.repository);
      dismissRun(queue, state, this.now());
      this.saveQueue(queue);
      await this.advanceQueue(state.run.repository);
      return this.queueSnapshot(queue);
    });
  }

  /** Rejects an unknown pipeline or a `skip` that does not fit it. */
  private async ensureItem(
    repository: string,
    pipeline: string,
    skip: readonly string[] = [],
  ): Promise<void> {
    const config = loadConfig(
      configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME),
    );
    if (!findPipeline(config, pipeline)) {
      const known = config.pipelines.map((candidate) => candidate.id).join(', ') || 'none';
      throw rejected(`unknown pipeline \`${pipeline}\`; known: ${known}`);
    }
    const error = checkSkip(config, pipeline, skip);
    if (error !== null) throw rejected(error);
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
            pipeline,
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
            throw rejected('a returned run keeps its own task');
          }
          const parentState =
            parentParam === undefined || parentParam === null
              ? null
              : this.resolveParent(repository, parentParam);
          if (returned?.run && skip !== undefined) {
            // A returned run has no item-level skip: the steps are skipped in the run itself.
            checkReturnedPatch(
              {
                pipeline,
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
            if (!state) throw rejected(`unknown run \`${returned.run}\``);
            const wanted = new Set(skip);
            const current = new Set(state.run.skippedSteps);
            const skipError = checkSkip(state.run.config, state.run.pipeline, [...wanted]);
            if (skipError !== null) throw rejected(skipError);
            const changes = [
              ...[...current].filter((step) => !wanted.has(step)).map((step) => [step, false]),
              ...[...wanted].filter((step) => !current.has(step)).map((step) => [step, true]),
            ] as [string, boolean][];
            for (const [step] of changes) {
              if (stepStates(state).find((entry) => entry.id === step)?.state === 'done') {
                throw rejected(`step \`${step}\` is already passed by every group`);
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
          if (pipeline !== undefined || skip !== undefined) {
            const current = queue.items.find((candidate) => candidate.id === item);
            if (current) {
              await this.ensureItem(repository, pipeline ?? current.pipeline, skip ?? current.skip);
            }
          }
          const after =
            request.params.after === undefined
              ? undefined
              : this.resolveDependencies(queue, request.params.after);
          let tags =
            request.params.tags === undefined
              ? undefined
              : resolveManualTags(this.catalogOf(repository), request.params.tags);
          const existing = queue.items.find((candidate) => candidate.id === item);
          const before = existing?.tags ?? [];
          if (existing && tags !== undefined) {
            const catalog = this.catalogOf(repository);
            tags = keepLinkedTags(catalog, knownTags(catalog, existing.tags), tags);
          }
          const parentPending = existing !== undefined && parentParam !== undefined;
          const patch = {
            pipeline,
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
            const parentTag = parentState ? await this.parentTagFor(repository, parentState) : null;
            const rest = withoutLinkedTags(this.catalogOf(repository), tags ?? existing.tags);
            tags = mergeTags(parentTag ? [parentTag.id] : [], rest);
          }
          if (existing && after !== undefined) {
            const fresh = after.filter((ref) => !existing.after.includes(ref));
            const inherited = knownTags(
              this.catalogOf(repository),
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
          if (!item) throw rejected('unknown queue item');
          if (item.run !== null) {
            const target = this.lookupState(item.run);
            if (!target) throw rejected(`unknown run \`${item.run}\``);
            if (target.run.hold === null && retryableGroups(target).length === 0) {
              throw rejected('run has no failed or cancelled groups');
            }
            await this.claimPlaceFor(queue, item.run);
            const resumed = await this.takeReturned(queue, item);
            this.saveQueue(queue);
            return resumed;
          }
          const created = await this.createRun(
            itemParams(queue, item),
            knownTags(this.catalogOf(queue.repository), item.tags),
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
      this.catalogOf(state.run.repository),
      this.waitLookup,
      this.repositories.artifacts.artifactCounts(state.run.id),
      this.observers,
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

  /** The commits a group's changes lie between, or null when they are not recorded yet. */
  private async groupRange(state: RunState, group: Group): Promise<[string, string] | null> {
    const { repository } = state.run;
    if (group.status === 'merged' && group.mergeCommit) {
      return [`${group.mergeCommit}^1`, group.mergeCommit];
    }
    const ref = groupRef(state.run, group.slug);
    const run = runRef(state.run);
    if ((await refExists(repository, ref)) && (await refExists(repository, run))) {
      return [await git(repository, 'merge-base', run, ref), ref];
    }
    return null;
  }

  /** The documents of the OpenSpec change the group made or is making. */
  private async groupSpec(params: ParamsOf<'group_spec'>): Promise<GroupSpecView | null> {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw rejected(`unknown group \`${params.group}\` in run ${params.runId}`);
    if (isServiceGroup(group)) return null;
    const { repository } = state.run;
    const pathspec = 'openspec/changes';
    try {
      const worktree = this.executor.worktreePath(state, group);
      let paths: string[];
      let read: (path: string) => Promise<string | null>;
      if (group.status !== 'merged' && existsSync(worktree)) {
        const base = await git(worktree, 'merge-base', runRef(state.run), 'HEAD');
        paths = await changedPathsSince(worktree, base, pathspec);
        read = (path) =>
          Promise.resolve(
            (() => {
              try {
                return readFileSync(join(worktree, path), 'utf8');
              } catch {
                return null;
              }
            })(),
          );
      } else {
        const range = await this.groupRange(state, group);
        if (range === null) return null;
        paths = await changedPathsBetween(repository, range[0], range[1], pathspec);
        read = (path) => readFileAt(repository, range[1], path);
      }
      for (const candidate of pickSpecChange(paths)) {
        const design = await read(`${candidate.path}/design.md`);
        const tasks = await read(`${candidate.path}/tasks.md`);
        if (design !== null || tasks !== null) return { ...candidate, design, tasks };
      }
    } catch {
      // the worktree or the commits are gone; show no change
    }
    return null;
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
      const range = await this.groupRange(state, group);
      if (range === null) return;
      const from = await git(repository, 'rev-parse', range[0]);
      const to = await git(repository, 'rev-parse', range[1]);
      const stat = await diffStat(repository, from, to);
      this.diffs.set(key, { ...stat, revision: `${from}..${to}` });
      this.broadcast(state);
    } catch {
      // the commits are gone (for example after git gc); leave the statistics unknown
    } finally {
      this.diffing.delete(key);
      if (this.diffAgain.delete(key)) void this.refreshDiff(state, slug);
    }
  }

  /**
   * Keeps the patch of the merged groups of a run in the patch storage and its URI in the
   * database. Serialized per run; failures are written to stderr and never reach the caller.
   */
  savePatch(state: RunState): Promise<void> {
    const id = state.run.id;
    const next = (this.patching.get(id) ?? Promise.resolve())
      .then(() => this.writePatch(state))
      .catch((error: unknown) => {
        if (this.stopping) return;
        process.stderr.write(`aip daemon: cannot save the patch of run ${id}: ${String(error)}\n`);
      });
    this.patching.set(id, next);
    return next;
  }

  private async writePatch(state: RunState): Promise<void> {
    if (!hasMergedChanges(state)) return;
    const { repository, id } = state.run;
    const ref = runRef(state.run);
    if (!(await refExists(repository, ref))) return;
    const commit = await git(repository, 'rev-parse', ref);
    const { patches } = this.repositories;
    const stored = patches.runPatch(id);
    if (stored?.commit === commit) return;
    const bytes = await rangePatch(repository, state.run.baseCommit, commit);
    const uri = await this.patchStorages[0]!.put(id, commit, bytes);
    patches.setRunPatch(id, { uri, commit, size: bytes.length, createdAt: this.now() });
    if (stored && stored.uri !== uri) {
      await storageFor(this.patchStorages, stored.uri)
        ?.remove(stored.uri)
        .catch(() => undefined);
    }
  }

  /** Removes patch files of runs the database does not know and superseded ones. */
  private async sweepPatches(): Promise<void> {
    const keep = new Map<string, string>();
    for (const id of this.repositories.patches.runPatchIds()) {
      const record = this.repositories.patches.runPatch(id);
      if (record) keep.set(id, record.uri);
    }
    for (const storage of this.patchStorages) await storage.sweep(keep).catch(() => undefined);
  }

  /** Removes artifact files of runs the database does not know and files it has no record of. */
  private async sweepArtifacts(): Promise<void> {
    const keep = this.repositories.artifacts.artifactUris();
    for (const storage of this.artifactStorages) await storage.sweep(keep).catch(() => undefined);
  }

  private groupArtifacts(params: ParamsOf<'group_artifacts'>): ArtifactView[] {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw rejected(`unknown group \`${params.group}\` in run ${params.runId}`);
    return this.repositories.artifacts.artifacts(state.run.id, group.slug).map((record) => {
      const attempt = group.attempts.find((candidate) => candidate.seq === record.seq);
      return {
        id: record.id,
        step: record.step,
        stepName: attempt ? attemptStepLabel(state, group, attempt) : record.step,
        seq: record.seq,
        specialist: record.specialist,
        title: record.title,
        fileName: record.fileName,
        size: record.size,
        createdAt: record.createdAt,
        preview: artifactPreview(record.fileName),
      };
    });
  }

  private async artifactContent(params: ParamsOf<'artifact'>): Promise<ArtifactContentView> {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw rejected(`unknown group \`${params.group}\` in run ${params.runId}`);
    const record = this.repositories.artifacts.artifact(state.run.id, params.id);
    if (!record || record.group !== group.slug) {
      throw rejected(`unknown artifact \`${params.id}\``);
    }
    const bytes =
      (await artifactStorageFor(this.artifactStorages, record.uri)?.get(record.uri)) ?? null;
    if (bytes === null) throw rejected(`artifact \`${params.id}\` is not available`);
    return { fileName: record.fileName, size: bytes.length, base64: bytes.toString('base64') };
  }

  private async artifactPublish(params: ParamsOf<'artifact_publish'>): Promise<{ id: string }> {
    const key = this.executor.attemptFor(params.token);
    if (!key) throw rejected('unknown or expired report token');
    const state = this.state(key.run);
    const group = findGroup(state, key.group);
    const attempt = group?.attempts.find((candidate) => candidate.seq === key.seq);
    if (!group || !attempt || attempt.status !== 'running') {
      throw rejected('unknown or expired report token');
    }
    const bytes =
      params.content !== undefined
        ? Buffer.from(params.content, 'utf8')
        : await this.readArtifactFile(this.executor.worktreePath(state, group), params.path ?? '');
    const runId = state.run.id;
    const fileName = params.fileName;
    const { artifacts } = this.repositories;
    return this.serial(async () => {
      const existing = artifacts.findArtifact(runId, group.slug, attempt.seq, fileName);
      if (!existing && artifacts.artifactCount(runId, group.slug) >= ARTIFACTS_PER_GROUP) {
        throw rejected(`a group may have at most ${ARTIFACTS_PER_GROUP} artifacts`);
      }
      const id = existing?.id ?? randomUUID();
      const uri = await this.artifactStorages[0]!.put(runId, id, bytes);
      const { artifact, previousUri } = artifacts.addArtifact({
        id,
        runId,
        group: group.slug,
        step: attempt.stepId,
        seq: attempt.seq,
        specialist: attempt.specialist,
        title: params.title ?? artifactTitle(fileName),
        fileName,
        size: bytes.length,
        uri,
        createdAt: this.now(),
      });
      if (previousUri !== null && previousUri !== uri) {
        await artifactStorageFor(this.artifactStorages, previousUri)
          ?.remove(previousUri)
          .catch(() => undefined);
      }
      this.broadcast(state);
      return { id: artifact.id };
    });
  }

  /** Reads a regular file inside the worktree (symlinks resolved, `.git` excluded), size-limited. */
  private async readArtifactFile(worktree: string, path: string): Promise<Buffer> {
    let root: string;
    let target: string;
    try {
      root = await realpath(worktree);
      target = await realpath(isAbsolute(path) ? path : resolve(root, path));
    } catch {
      throw rejected(`cannot read \`${path}\`: no such file in the worktree`);
    }
    const inside = target.startsWith(root + sep) ? target.slice(root.length + 1) : null;
    if (inside === null || inside.split(sep)[0] === '.git') {
      throw rejected(`\`${path}\` is outside of the worktree of the group`);
    }
    const before = await stat(target);
    if (!before.isFile()) throw rejected(`\`${path}\` is not a regular file`);
    if (before.size > ARTIFACT_FILE_LIMIT) {
      throw rejected(`\`${path}\` is larger than ${ARTIFACT_FILE_LIMIT} bytes`);
    }
    const handle = await open(target, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw rejected(`\`${path}\` is not a regular file`);
      if (info.size > ARTIFACT_FILE_LIMIT) {
        throw rejected(`\`${path}\` is larger than ${ARTIFACT_FILE_LIMIT} bytes`);
      }
      const buffer = Buffer.alloc(Math.min(info.size, ARTIFACT_FILE_LIMIT));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async runPatch(params: ParamsOf<'run_patch'>): Promise<RunPatchView> {
    const state = this.state(params.runId);
    const id = state.run.id;
    if (!hasMergedChanges(state)) throw rejected(`run ${id} has no merged changes`);
    const { repository } = state.run;
    const ref = runRef(state.run);
    const present = await refExists(repository, ref);
    if (present) await this.savePatch(state);
    const record = this.repositories.patches.runPatch(id);
    let bytes: Buffer | null = null;
    if (record) bytes = (await storageFor(this.patchStorages, record.uri)?.get(record.uri)) ?? null;
    if (bytes === null && present) {
      bytes = await rangePatch(
        repository,
        state.run.baseCommit,
        await git(repository, 'rev-parse', ref),
      );
    }
    if (bytes === null) {
      throw rejected(
        present || record
          ? `the patch of run ${id} is not available`
          : `the patch of run ${id} is not available: run refs are removed`,
      );
    }
    return { fileName: `${id}.patch`, size: bytes.length, base64: bytes.toString('base64') };
  }

  private async groupFileDiff(params: ParamsOf<'group_file_diff'>): Promise<FileDiffView> {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw rejected(`unknown group \`${params.group}\` in run ${params.runId}`);
    const key = `${state.run.id}/${group.slug}`;
    if (!this.diffs.has(key)) await this.refreshDiff(state, group.slug);
    const stat = this.diffs.get(key);
    if (!stat) throw rejected(`the diff of group ${group.slug} is not available`);
    const file = stat.files.find((entry) => entry.path === params.path);
    if (!file) throw rejected(`${params.path} is not changed in group ${group.slug}`);
    const previousPath = file.previousPath ?? null;
    if (file.added === null) {
      return {
        path: file.path,
        previousPath,
        binary: true,
        lines: [],
        totalLines: 0,
        truncated: false,
      };
    }
    try {
      const range = await this.groupRange(state, group);
      if (range === null) throw new Error('refs are removed');
      const diff = await fileDiff(
        state.run.repository,
        range[0],
        range[1],
        previousPath ? [previousPath, file.path] : [file.path],
        { context: FILE_DIFF_CONTEXT, maxLines: FILE_DIFF_MAX_LINES },
      );
      return { path: file.path, previousPath, binary: false, ...diff };
    } catch {
      throw rejected(`the diff of ${params.path} is not available`);
    }
  }

  subscribe(send: (line: string) => void): () => void {
    this.seq += 1;
    const runs = this.repositories.finished
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
    this.requestObserve();
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
    this.database.close();
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
      throw rejected(`not a background process: ${pid}`);
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
    const loaded = this.repositories.runs.loadRun(runIdentifier);
    if (!loaded) throw rejected(`unknown run \`${runIdentifier}\``);
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
      const effects = dispatch([...this.states.values()], this.now());
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
    this.waits = planDispatch(states, this.now()).waits;
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
        return Promise.reject(rejected('subscribe is served on its own connection'));
      case 'observers':
        return Promise.resolve(this.observersSnapshot());
      case 'observers_set':
        return this.serial(() => this.observersSet(request.params.settings));
      case 'run_observer':
        return this.event(request.params.runId, {
          kind: 'repair_allowed',
          allowed: request.params.enabled,
        });
      case 'repair_action':
        return this.repairAction(request.params);
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
        return this.panel ? this.panel.start(request.params) : Promise.reject(rejected(NO_PANEL));
      case 'web_stop':
        return this.panel ? this.panel.stop() : Promise.reject(rejected(NO_PANEL));
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
      case 'finished_runs':
        return Promise.resolve(this.finishedRuns(request.params));
      case 'group':
        return Promise.resolve(this.group(request.params));
      case 'group_spec':
        return this.groupSpec(request.params);
      case 'group_file_diff':
        return this.groupFileDiff(request.params);
      case 'run_patch':
        return this.runPatch(request.params);
      case 'group_artifacts':
        return Promise.resolve(this.groupArtifacts(request.params));
      case 'artifact':
        return this.artifactContent(request.params);
      case 'artifact_publish':
        return this.artifactPublish(request.params);
      case 'transcript':
        return Promise.resolve(this.transcript(request.params));
      case 'pipelines':
        return this.pipelines(request.params.repository);
      case 'system_stages':
        return this.systemStages(request.params.repository);
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
      case 'specialist_tags':
        return Promise.resolve(this.specialistTags());
      case 'shared_specialists':
        return Promise.resolve(this.sharedSpecialists());
      case 'specialist_tags_set':
        return this.specialistTagEdit(request.params.repository, (paths, level) =>
          planTagsSet(
            paths,
            level,
            request.params.slug,
            request.params.tags,
            request.params.revision,
          ),
        );
      case 'specialist_tag_rename':
        return this.specialistTagEdit(request.params.repository, (paths, level) =>
          planTagRename(paths, level, request.params.from, request.params.to),
        );
      case 'specialist_tag_remove':
        return this.specialistTagEdit(request.params.repository, (paths, level) =>
          planTagRemove(paths, level, request.params.tag),
        );
      case 'shared_pipelines':
        return Promise.resolve(this.sharedPipelines());
      case 'pipelines_import':
        return this.pipelinesImport(request.params);
      case 'specialists_import':
        return this.specialistsImport(request.params);
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
      case 'message': {
        const { runId: id, group, seq, text } = request.params;
        return this.event(id, { kind: 'message', group, seq, text });
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
            ...(request.params.human_only === true ? { humanOnly: true } : {}),
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
      case 'run_mark_delivered':
        return this.markDelivered(request.params);
      case 'tags':
        return this.rootOf(request.params.repository).then((repository) =>
          catalogView(this.catalogOf(repository)),
        );
      case 'tag_add':
        return this.serial(() => this.tagAdd(request.params));
      case 'tag_edit':
        return this.serial(() => this.tagEdit(request.params));
      case 'tag_remove':
        return this.serial(() => this.tagRemove(request.params));
      case 'run_title':
        return this.serial(() => this.runTitle(request.params));
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
    return this.serial(() => this.retryNow(this.state(params.runId), params));
  }

  /** The retry itself, for callers that already run inside `serial`. */
  private async retryNow(
    state: RunState,
    params: { group: string; refreshConfig?: boolean },
  ): Promise<unknown> {
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
  }

  /** `observers_set`: new settings replace the old ones only when every value is right. */
  private observersSet(
    settings: Record<string, unknown>,
  ): Promise<{ ok: true; observers: ObserversView } | { ok: false; errors: FieldError[] }> {
    const checked = checkObserverSettings(settings, this.observers, new Set(this.registry.keys()));
    if (checked.settings === null) return Promise.resolve({ ok: false, errors: checked.errors });
    this.observers = checked.settings;
    this.repositories.observers.saveObservers(this.observers);
    // The state `repair` of every run depends on the settings: send the runs again.
    for (const state of this.states.values()) this.broadcast(state);
    return this.observe(true).then(() => {
      this.publishObservers();
      return { ok: true as const, observers: this.observersSnapshot() };
    });
  }

  /** An action of an observer: only on its own run, by the rules of a person. */
  private repairAction(params: ParamsOf<'repair_action'>): Promise<unknown> {
    return this.serial(async () => {
      const key = this.executor.attemptFor(params.token);
      if (!key || key.group !== REPAIR_GROUP) throw rejected('unknown or expired report token');
      const state = this.state(key.run);
      const attempt = state.repair?.attempts.find((candidate) => candidate.seq === key.seq);
      if (!attempt || attempt.status !== 'running') {
        throw rejected('unknown or expired report token');
      }
      const target = (slug: string): Group => {
        const group = findGroup(state, slug);
        if (!group) throw rejected(`unknown group \`${slug}\` in run ${state.run.id}`);
        if (isServiceGroup(group) && !isSplitGroup(group)) {
          throw rejected(`group \`${slug}\` is a service group; observers do not touch it`);
        }
        return group;
      };
      switch (params.action) {
        case 'answer': {
          const group = target(params.group);
          if (group.humanOnly !== null && !this.observers.answerHumanOnly) {
            throw rejected(`the question of group \`${group.slug}\` is for a person only`);
          }
          await this.apply(state, {
            kind: 'answer',
            group: group.slug,
            answer: params.answer,
            by: 'observer',
            permissions: this.currentPermissions(state),
          });
          break;
        }
        case 'retry': {
          const group = target(params.group);
          if (group.status === 'cancelled') {
            throw rejected(`group \`${group.slug}\` was cancelled; observers do not restart it`);
          }
          await this.retryNow(state, { group: group.slug, refreshConfig: params.refreshConfig });
          break;
        }
        case 'cancel': {
          const group = params.group === undefined ? null : target(params.group);
          await this.apply(state, {
            kind: 'cancel',
            group: group?.slug ?? null,
            reason: params.reason,
          });
          break;
        }
      }
      return { recorded: true };
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
          .map((group) => ({ slug: group.slug, delivery: deliveryOutcome(group.delivery) })),
      };
    });
  }

  private markDelivered(params: ParamsOf<'run_mark_delivered'>): Promise<ApplyResult> {
    return this.serial(async () => {
      const state = this.state(params.runId);
      const requested = params.groups ?? null;
      const before = new Set(
        state.groups
          .filter((group) => group.delivery.state === 'applied')
          .map((group) => group.slug),
      );
      await this.apply(state, { kind: 'delivered_marked', groups: requested });
      return {
        runId: state.run.id,
        pending: false,
        groups: state.groups
          .filter((group) =>
            requested && requested.length > 0
              ? requested.includes(group.slug)
              : group.status === 'merged' && !before.has(group.slug),
          )
          .map((group) => ({ slug: group.slug, delivery: deliveryOutcome(group.delivery) })),
      };
    });
  }

  /** The tags of one repository; names are unique and resolved inside it only. */
  private catalogOf(repository: string): Tag[] {
    return tagsOfRepository(this.catalog, repository);
  }

  /** Publishes all tags and returns the catalog of the changed repository. */
  private publishTags(repository: string): TagView[] {
    if (this.subscribers.size > 0) {
      this.seq += 1;
      const line = JSON.stringify({
        event: 'tags',
        seq: this.seq,
        repository,
        tags: catalogView(this.catalog),
      });
      for (const send of this.subscribers) send(line);
    }
    return catalogView(this.catalogOf(repository));
  }

  private createTag(input: {
    repository: string;
    name: string;
    color?: string | undefined;
    task?: { run: string; number: number } | undefined;
  }): Tag {
    const now = this.now();
    let id = tagId(now, randomInt(36 ** 3));
    while (this.catalog.some((tag) => tag.id === id)) id = tagId(now, randomInt(36 ** 3));
    const tag = input.task
      ? addLinkedTag(
          this.catalogOf(input.repository),
          { name: input.name, task: input.task, repository: input.repository },
          id,
          now,
        )
      : addTag(this.catalogOf(input.repository), input, id, now);
    this.repositories.tags.saveTag(tag);
    this.catalog = [...this.catalog, tag];
    return tag;
  }

  private async tagAdd(params: ParamsOf<'tag_add'>): Promise<TagView[]> {
    const repository = await this.rootOf(params.repository);
    this.createTag({ ...params, repository });
    return this.publishTags(repository);
  }

  private async tagEdit(params: ParamsOf<'tag_edit'>): Promise<TagView[]> {
    const repository = await this.rootOf(params.repository);
    const tag = editTag(this.catalogOf(repository), params.tag, params);
    this.repositories.tags.saveTag(tag);
    this.catalog = this.catalog.map((candidate) => (candidate.id === tag.id ? tag : candidate));
    return this.publishTags(repository);
  }

  /** Takes the tag off every run and queue item, in memory and in the database, then publishes. */
  private async tagRemove(params: ParamsOf<'tag_remove'>): Promise<TagView[]> {
    const repository = await this.rootOf(params.repository);
    const { id } = removeTag(this.catalogOf(repository), params.tag);
    // Three tables, one transaction: the scenario is opened here, each repository changes its own.
    this.database.transaction(() => {
      this.repositories.tags.deleteTag(repository, id);
      this.repositories.runs.dropTag(repository, id);
      this.repositories.queues.dropItemTag(repository, id);
    });
    this.catalog = this.catalog.filter((tag) => tag.id !== id);
    for (const state of [...this.states.values()]) {
      if (state.run.repository === repository && state.run.tags.includes(id)) {
        await this.apply(state, {
          kind: 'tags_set',
          tags: state.run.tags.filter((tag) => tag !== id),
        });
      }
    }
    for (const queue of this.queues.values()) {
      if (queue.repository !== repository) continue;
      if (!queue.items.some((item) => item.tags.includes(id))) continue;
      for (const item of queue.items) item.tags = item.tags.filter((tag) => tag !== id);
      queue.updatedAt = this.now();
      this.saveQueue(queue);
    }
    return this.publishTags(repository);
  }

  /** Own tags plus the tags of the predecessors in `after`, only those still in the catalog. */
  private inheritTags(queue: Queue, own: string[], after: string[]): string[] {
    const inherited = dependencyTags(queue, after, (id) => this.lookupState(id)?.run.tags);
    return knownTags(this.catalogOf(queue.repository), mergeTags(own, inherited));
  }

  private async runTitle(params: ParamsOf<'run_title'>): Promise<RunView> {
    const state = this.state(params.runId);
    await this.apply(state, { kind: 'title_set', title: params.title });
    return this.view(state);
  }

  private async runTags(params: ParamsOf<'run_tags'>): Promise<RunView> {
    const state = this.state(params.runId);
    const catalog = this.catalogOf(state.run.repository);
    const add = resolveManualTags(catalog, params.add ?? []);
    const remove = new Set(resolveTags(catalog, params.remove ?? []));
    const current = knownTags(catalog, state.run.tags).filter((id) => !remove.has(id));
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
    const { pipeline, task, groups, title, autoDeliver, deliveryMode, skip } = params;
    await this.ensureItem(repository, pipeline, skip);
    const after = this.resolveDependencies(queue, params.after ?? []);
    const manual = resolveManualTags(this.catalogOf(repository), params.tags ?? []);
    const parent =
      params.parent === undefined ? null : this.resolveParent(repository, params.parent);
    if (parent) {
      this.checkNewItem(
        queue,
        { pipeline, task, groups, title, autoDeliver, deliveryMode, skip, after },
        now,
      );
    }
    const parentTag = parent ? await this.parentTagFor(repository, parent) : null;
    const tags = this.inheritTags(queue, mergeTags(parentTag ? [parentTag.id] : [], manual), after);
    const item = addItem(
      queue,
      { pipeline, task, groups, title, autoDeliver, deliveryMode, tags, skip, after },
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
      throw rejected(queue.stop.error);
    }
    return { item: item.id, number: item.number, run, queue: this.queueSnapshot(queue) };
  }

  private async addQueueItem(
    repository: string,
    params: Pick<
      ParamsOf<'queue_add'>,
      | 'pipeline'
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
    const { pipeline, task, groups, title, autoDeliver, deliveryMode, skip, postponed } = params;
    const queue = this.queueFor(repository);
    const now = this.now();
    await this.ensureItem(repository, pipeline, skip);
    const after = this.resolveDependencies(queue, params.after ?? []);
    let own = inherited ?? resolveManualTags(this.catalogOf(repository), params.tags ?? []);
    if (params.parent !== undefined) {
      const parent = this.resolveParent(repository, params.parent);
      this.checkNewItem(
        queue,
        { pipeline, task, groups, title, autoDeliver, deliveryMode, skip, after, postponed },
        now,
      );
      const parentTag = await this.parentTagFor(repository, parent);
      own = mergeTags(parentTag ? [parentTag.id] : [], own);
    }
    const tags = this.inheritTags(queue, own, after);
    const item = addItem(
      queue,
      { pipeline, task, groups, title, autoDeliver, deliveryMode, tags, skip, after, postponed },
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
      const id = this.repositories.runs.runIdByNumber(repository, parsed.number);
      const state = id === null ? undefined : this.lookupState(id);
      if (state) return state;
    }
    throw rejected(`unknown parent \`${ref}\``);
  }

  /**
   * The linked task tag of a parent for a task of `repository`. A parent from another
   * repository gives no tag: the catalogs are per repository, and nothing is created there.
   */
  private async parentTagFor(repository: string, parent: RunState): Promise<Tag | null> {
    return parent.run.repository === repository ? this.linkedTagFor(parent) : null;
  }

  /**
   * The linked task tag of the run: the existing one or a new one named after the run.
   * The tag goes to the run itself too (first), and to the items that wait for it.
   */
  private async linkedTagFor(state: RunState): Promise<Tag> {
    const run = state.run;
    const catalog = this.catalogOf(run.repository);
    let tag = linkedTagOf(catalog, run.id);
    if (!tag) {
      const base = run.name ?? (run.title ? runName(run.title) : run.id);
      tag = this.createTag({
        repository: run.repository,
        name: autoTagName(catalog, base),
        task: { run: run.id, number: run.number },
      });
      this.publishTags(run.repository);
    }
    const own = knownTags(this.catalogOf(run.repository), run.tags);
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
      if (!key) throw rejected('unknown or expired report token');
      const state = this.state(key.run);
      const attempt = state.groups
        .find((group) => group.slug === key.group)
        ?.attempts.find((candidate) => candidate.seq === key.seq);
      if (!attempt || attempt.status !== 'running') {
        throw rejected('unknown or expired report token');
      }
      if (findSpecialist(state.run.config, attempt.specialist)?.queue !== true) {
        throw rejected(`specialist \`${attempt.specialist}\` may not add tasks to the queue`);
      }
      // Every task carries the linked task tag of its run, then the other tags of the run.
      const repository = state.run.repository;
      await this.ensureItem(repository, params.pipeline, params.skip);
      const queue = this.queueFor(repository);
      const after = this.resolveDependencies(queue, params.after ?? []);
      const { pipeline, task, groups, title, autoDeliver, deliveryMode, skip } = params;
      this.checkNewItem(
        queue,
        { pipeline, task, groups, title, autoDeliver, deliveryMode, skip, after },
        this.now(),
      );
      const tag = await this.linkedTagFor(state);
      return this.addQueueItem(
        repository,
        params,
        mergeTags([tag.id], knownTags(this.catalogOf(repository), state.run.tags)),
      );
    });
  }

  private workerEvent(token: string, build: (key: AttemptKey) => Event): Promise<unknown> {
    return this.serial(async () => {
      const key = this.executor.attemptFor(token);
      if (!key) throw rejected('unknown or expired report token');
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
      const started = this.repositories.runs.runOfQueueItem(queue.repository, id);
      if (started) return started.run.id;
      throw rejected(`unknown dependency \`${id}\``);
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
    if (!findPipeline(config, params.pipeline)) {
      const known = config.pipelines.map((pipeline) => pipeline.id).join(', ') || 'none';
      throw rejected(`unknown pipeline \`${params.pipeline}\`; known: ${known}`);
    }
    const skipError = checkSkip(config, params.pipeline, params.skip ?? []);
    if (skipError !== null) throw rejected(skipError);
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
      pipeline: params.pipeline,
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
    return this.repositories.finished
      .recentRuns()
      .map((stored) => this.view(this.states.get(stored.run.id) ?? stored, now));
  }

  /** A page of finished runs after the cursor `<created_at>.<id>`; `next` is null at the end. */
  private finishedRuns(params: { limit: number; before?: string | undefined }): unknown {
    let before: { createdAt: number; id: string } | undefined;
    if (params.before !== undefined) {
      const match = /^(\d+)\.(.+)$/.exec(params.before);
      if (!match) throw rejected('before is not a valid cursor');
      before = { createdAt: Number(match[1]), id: match[2] ?? '' };
    }
    const now = this.now();
    const page = this.repositories.finished.finishedRunsPage(params.limit, before);
    const runs = page.runs.map((stored) =>
      this.view(this.states.get(stored.run.id) ?? stored, now),
    );
    const last = page.runs.at(-1);
    return {
      runs,
      next: page.more && last ? `${last.run.createdAt}.${last.run.id}` : null,
    };
  }

  /**
   * Whole specialists of the current configuration of the run's repository; a configuration that
   * does not load or pass validation refuses the request.
   */
  private currentSpecialists(state: RunState): SpecialistsRefresh {
    try {
      return specialistsOf(loadConfig(this.configPathsOf(state.run.repository)));
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw rejected((error as Error).message);
      const { detail } = error;
      const first = detail.kind === 'invalid' ? detail.errors[0] : undefined;
      throw rejected(
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
      if (error instanceof ConfigEditError) throw rejected(error.message);
      throw error;
    }
    if (!plan.ok) return plan;
    if (
      (edit.kind === 'specialist' || edit.kind === 'pipeline') &&
      edit.value === null &&
      edit.level === 'global'
    ) {
      const references =
        edit.kind === 'specialist'
          ? this.sharedUsageOf(repository, edit.id)
          : this.sharedPipelineUsageOf(repository, edit.id);
      if (references.length > 0) return { ok: false, reason: 'invalid', errors: [], references };
    }
    const result = { ok: true as const, ...commitEdit(plan) };
    this.republishQueue(repository);
    return result;
  }

  /** The shared specialists with the repositories of the registry that need them. */
  private sharedSpecialists(): SharedSpecialistsView {
    const roots = this.repositoryList().map((entry) => entry.path);
    return sharedSpecialistUsage(
      this.configPathsOf('/'),
      roots.map((root) => ({ repository: root, paths: this.configPathsOf(root) })),
    );
  }

  /** References to a shared specialist from the registry and the requesting repository. */
  private sharedUsageOf(repository: string, slug: string): EntryReference[] {
    const roots = new Set(this.repositoryList().map((entry) => entry.path));
    roots.add(repository);
    const usage = sharedSpecialistUsage(
      this.configPathsOf('/'),
      [...roots].map((root) => ({ repository: root, paths: this.configPathsOf(root) })),
      slug,
    ).specialists[0];
    return (usage?.projects ?? []).flatMap((project) =>
      project.references.map((reference) => ({ ...reference, repository: project.repository })),
    );
  }

  /** The shared pipelines with the repositories of the registry that need them. */
  private sharedPipelines(): SharedPipelinesView {
    const roots = this.repositoryList().map((entry) => entry.path);
    return sharedPipelineUsage(
      this.configPathsOf('/'),
      roots.map((root) => ({ repository: root, paths: this.configPathsOf(root) })),
    );
  }

  /** References to a shared pipeline from the registry and the requesting repository. */
  private sharedPipelineUsageOf(repository: string, id: string): EntryReference[] {
    const roots = new Set(this.repositoryList().map((entry) => entry.path));
    roots.add(repository);
    const usage = sharedPipelineUsage(
      this.configPathsOf('/'),
      [...roots].map((root) => ({ repository: root, paths: this.configPathsOf(root) })),
      id,
    ).pipelines[0];
    return (usage?.projects ?? []).flatMap((project) =>
      project.references.map((reference) => ({ ...reference, repository: project.repository })),
    );
  }

  private tagFolderOf(repository: string | null): SpecialistTagFolderView {
    const paths = this.configPathsOf(repository ?? '/');
    return { repository, ...tagFolder(paths, repository === null ? 'global' : 'project') };
  }

  /** The shared level, then one folder per repository of the registry. */
  private specialistTags(): SpecialistTagsView {
    return {
      folders: [null, ...this.repositoryList().map((entry) => entry.path)].map((repository) =>
        this.tagFolderOf(repository),
      ),
    };
  }

  /** Plans and writes without an await between them, so two edits never interleave. */
  private async specialistTagEdit(
    repository: string | null,
    plan: (paths: ConfigPaths, level: 'global' | 'project') => TagPlan,
  ): Promise<SpecialistTagsResult> {
    if (repository !== null && !this.registry.has(repository)) {
      throw rejected(`unknown repository ${repository}`);
    }
    let planned: TagPlan;
    try {
      planned = plan(
        this.configPathsOf(repository ?? '/'),
        repository === null ? 'global' : 'project',
      );
    } catch (error) {
      if (error instanceof ConfigEditError) throw rejected(error.message);
      throw error;
    }
    if (!planned.ok) return planned;
    commitEdits(planned.edits);
    if (repository !== null) this.republishQueue(repository);
    return { ok: true, folder: this.tagFolderOf(repository) };
  }

  private async specialistsImport(
    params: ParamsOf<'specialists_import'>,
  ): Promise<SpecialistsImportResult> {
    for (const path of [params.repository, params.source]) {
      if (!this.registry.has(path)) throw rejected(`unknown repository ${path}`);
    }
    if (params.repository === params.source) {
      throw rejected('the source must be another repository');
    }
    let planned: TagPlan;
    try {
      planned = planImport(
        this.configPathsOf(params.repository),
        this.configPathsOf(params.source),
        params.slugs,
      );
    } catch (error) {
      if (error instanceof ConfigEditError) throw rejected(error.message);
      throw error;
    }
    if (!planned.ok) return planned;
    commitEdits(planned.edits);
    this.republishQueue(params.repository);
    return { ok: true, imported: [...new Set(params.slugs)] };
  }

  private async pipelinesImport(
    params: ParamsOf<'pipelines_import'>,
  ): Promise<PipelinesImportResult> {
    for (const path of [params.repository, params.source]) {
      if (!this.registry.has(path)) throw rejected(`unknown repository ${path}`);
    }
    if (params.repository === params.source) {
      throw rejected('the source must be another repository');
    }
    let planned: TagPlan;
    try {
      planned = planImport(
        this.configPathsOf(params.repository),
        this.configPathsOf(params.source),
        params.ids,
        'pipeline',
      );
    } catch (error) {
      if (error instanceof ConfigEditError) throw rejected(error.message);
      throw error;
    }
    if (!planned.ok) {
      return planned.reason === 'conflict'
        ? {
            ok: false,
            reason: 'conflict',
            message: planned.message,
            ...(planned.slugs ? { ids: planned.slugs } : {}),
          }
        : planned;
    }
    commitEdits(planned.edits);
    this.republishQueue(params.repository);
    return { ok: true, imported: [...new Set(params.ids)] };
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
      if (error instanceof ConfigEditError) throw rejected(error.message);
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
    return { topology: config ? pipelineTopology(config, params.id) : null, errors };
  }

  private configPathsOf(repository: string): ConfigPaths {
    return configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME);
  }

  private async pipelines(path: string): Promise<PipelinesView> {
    const repository = await this.rootOf(path);
    try {
      const config = loadConfig(
        configPaths(repository, this.environment.XDG_CONFIG_HOME, this.environment.HOME),
      );
      return { repository, pipelines: pipelineTopologies(config), errors: [] };
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      const { detail } = error;
      const errors =
        detail.kind === 'invalid'
          ? detail.errors
          : [{ path: describePath(detail), message: error.message }];
      return { repository, pipelines: [], errors };
    }
  }

  /** The built-in stages of the pipeline with their tasks and the settings that apply. */
  private async systemStages(path: string): Promise<SystemStagesView> {
    const repository = await this.rootOf(path);
    const paths = this.configPathsOf(repository);
    try {
      const config = loadConfig(paths);
      const settings = new Map(
        editorView(paths).settings.map((setting) => [setting.path, setting]),
      );
      const pick = (keys: string[]): SystemStageSetting[] =>
        keys.flatMap((key) => {
          const setting = settings.get(key);
          if (!setting) return [];
          const level =
            setting.written.project !== undefined
              ? 'project'
              : setting.written.global !== undefined
                ? 'global'
                : 'default';
          return [{ path: key, value: setting.value, level }];
        });
      const { delivery } = config;
      const named = (slug: string | null): StagePerformer | null =>
        slug === null ? null : { type: 'specialist', slug, name: specialistName(config, slug) };
      const stages: SystemStageView[] = [
        {
          kind: 'split',
          name: 'Split',
          performer: null,
          task: splitInstructionText('{max_groups}'),
          settings: [],
        },
        {
          kind: 'message',
          name: 'Commit message',
          performer: named(delivery.messageSpecialist),
          task: [
            ...MESSAGE_INSTRUCTIONS('{run}'),
            'Task:\n{task}',
            'Groups:\n{groups}',
            'Changed files:\n{files}',
          ].join('\n\n'),
          settings: pick([
            'delivery.message_specialist',
            'delivery.message_prompt',
            'delivery.commit_message',
          ]),
        },
        {
          kind: 'delivery',
          name: 'Delivery',
          performer: { type: 'system' },
          task: null,
          settings: pick(['delivery.mode', 'delivery.auto', 'delivery.keep']),
        },
        {
          kind: 'resolve',
          name: 'Resolve conflicts',
          performer: named(delivery.resolver),
          task: [
            ...RESOLVE_INSTRUCTIONS('{run}'),
            'Conflicting files:\n{files}',
            'Task of the run:\n{task}',
            'Groups:\n{groups}',
          ].join('\n\n'),
          settings: pick([
            'delivery.resolver',
            'delivery.resolver_rounds',
            'delivery.resolver_prompt',
          ]),
        },
      ];
      return { repository, stages, errors: [] };
    } catch (error) {
      if (!(error instanceof ConfigLoadError)) throw error;
      const { detail } = error;
      const errors =
        detail.kind === 'invalid'
          ? detail.errors
          : [{ path: describePath(detail), message: error.message }];
      return { repository, stages: [], errors };
    }
  }

  private transcript(params: ParamsOf<'transcript'>): Transcript {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw rejected(`unknown group \`${params.group}\` in run ${params.runId}`);
    const attempt =
      params.seq === undefined
        ? group.attempts.at(-1)
        : group.attempts.find((candidate) => candidate.seq === params.seq);
    if (params.seq !== undefined && !attempt) {
      throw rejected(`unknown attempt ${params.seq} of group \`${params.group}\``);
    }
    const base = { runId: state.run.id, group: group.slug };
    if (!attempt) return { ...base, seq: null, cursor: 0, running: false, entries: [] };
    const logPath = this.executor.logPath(state, group.slug, attempt.seq);
    const after = params.after ?? 0;
    const { lines, cursor } = readLines(logPath, after);
    const moments = readTimes(timesPath(logPath));
    const times = lines.map((_, index) => moments.get(after + index) ?? null);
    const entries: TranscriptEntry[] =
      attempt.runtime === 'command'
        ? lines.flatMap((text, index): TranscriptEntry[] =>
            text === '' ? [] : [{ kind: 'raw', text, at: times[index] ?? null }],
          )
        : runtimeFor(attempt.runtime, this.environment).transcript(lines, times);
    const verdict = attempt.report?.verdict ?? null;
    for (const entry of entries) if (entry.kind === 'result') entry.verdict = verdict;
    return { ...base, seq: attempt.seq, cursor, running: attempt.status === 'running', entries };
  }

  private group(params: ParamsOf<'group'>): unknown {
    const state = this.state(params.runId);
    const group = findGroup(state, params.group);
    if (!group) throw rejected(`unknown group \`${params.group}\` in run ${params.runId}`);
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

const FILE_DIFF_CONTEXT = 5;
const FILE_DIFF_MAX_LINES = 2000;

function hasMergedChanges(state: RunState): boolean {
  return state.groups.some((group) => group.status === 'merged' && group.mergeCommit !== null);
}

/** The arguments of `run` that an item of the queue stands for. */
function itemParams(queue: Queue, item: QueueItem): ParamsOf<'run'> {
  return {
    repository: queue.repository,
    pipeline: item.pipeline,
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
