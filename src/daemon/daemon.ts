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
  planSetting,
  socketPath,
} from '../config/index.ts';
import {
  Rejection,
  addItem,
  checkSkip,
  addTag,
  advance,
  allGroups,
  createRun,
  editItem,
  editTag,
  emptyQueue,
  itemFailed,
  itemStarted,
  knownTags,
  moveItem,
  pauseQueue,
  queueItemId,
  removeItem,
  removeTag,
  resolveTags,
  setParallel,
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
  transition,
  workflowTopologies,
  workflowTopology,
  type Event,
  type PermissionsRefresh,
  type Queue,
  type QueueItem,
  type RunState,
  type Tag,
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
  type WebStopResult,
} from '../protocol/index.ts';
import { runtimeCatalog, runtimeFor } from '../runtime/index.ts';
import { Store, type KnownRepository } from '../store/index.ts';

import { Executor, type AttemptKey } from './executor.ts';
import { readLines, readTail } from './logs.ts';

const NO_PANEL = 'this daemon serves no web panel';

/** The web panel the daemon serves; implemented outside the daemon layer and passed in. */
export interface PanelControl {
  status(): WebStatusResult;
  start(options: { token?: string; restart?: boolean }): Promise<WebStartResult>;
  stop(): Promise<WebStopResult>;
}

export interface DaemonOptions {
  stateDirectory: string;
  entry: string[];
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  graceMs?: number;
  /** Build the daemon reports to its clients; defaults to the build of this process. */
  build?: BuildInfo;
  /** Serves `web_status`, `web_start` and `web_stop`; without it the daemon refuses them. */
  panel?: PanelControl;
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
  private readonly registry = new Map<string, KnownRepository>();
  private repositoriesJson = '';
  private catalog: Tag[] = [];

  constructor(options: DaemonOptions) {
    this.store = new Store(databasePath(options.stateDirectory));
    this.socket = socketPath(options.stateDirectory);
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? Date.now;
    this.build = options.build ?? currentBuild();
    this.panel = options.panel;
    this.executor = new Executor({
      daemon: this,
      entry: options.entry,
      graceMs: options.graceMs,
    });
  }

  async start(): Promise<void> {
    await this.serial(async () => {
      const recovered = this.store.recover(this.now());
      for (const { state } of recovered) this.states.set(state.run.id, state);
      const latest = [...this.states.values()].sort((a, b) => b.run.createdAt - a.run.createdAt)[0];
      if (latest) this.max = latest.run.config.max;
      for (const queue of this.store.queues()) this.queues.set(queue.repository, queue);
      this.catalog = this.store.tags();
      for (const entry of this.store.repositories()) this.registry.set(entry.path, entry);
      // A delivery cut off by the restart starts again.
      for (const { state, effects } of recovered) await this.executor.perform(state, effects);
      await this.schedule();
      for (const queue of [...this.queues.values()]) {
        if (queue.status === 'running' || queue.runs.length > 0) {
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
      (queue.runs.length > 0 || queue.items.some((item) => item.after.includes(state.run.id)))
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

  private queueFor(repository: string): Queue {
    const cached = this.queues.get(repository);
    if (cached) return cached;
    const queue = this.store.loadQueue(repository) ?? emptyQueue(repository, this.now());
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
    return queueView(
      queue,
      (id) => this.lookupState(id),
      this.deliveryAuto(queue.repository),
      this.catalog,
    );
  }

  /** `delivery.auto` of the repository now; null when its configuration cannot be loaded. */
  private deliveryAuto(repository: string): boolean | null {
    try {
      return loadConfig(this.configPathsOf(repository)).delivery.auto;
    } catch (error) {
      if (error instanceof ConfigLoadError) return null;
      throw error;
    }
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
    return view;
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
    const { take } = advance(queue, states, (id) => this.lookupState(id), this.now());
    let changed = fingerprint() !== before;
    for (const item of take) {
      try {
        const created = await this.createRun(
          itemParams(queue, item),
          knownTags(this.catalog, item.tags),
          item.id,
        );
        itemStarted(queue, item.id, created.runId, this.now());
        started.set(item.id, created);
        this.store.saveQueue(queue);
      } catch (error) {
        itemFailed(queue, item.id, (error as Error).message, this.now());
        changed = true;
        break;
      }
      changed = true;
    }
    if (changed) this.saveQueue(queue);
    else if (this.queueRuns.get(repository) !== queueSignature(this.queueSnapshot(queue))) {
      this.publishQueue(queue);
    }
    if (take.length > 0 && queue.runs.length > 0) this.requestAdvance(repository);
    return started;
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

  private queueRequest(request: Extract<Request, { method: `queue${string}` }>): Promise<unknown> {
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
          const { item, workflow, task, groups, title, position, autoDeliver, skip } =
            request.params;
          const after =
            request.params.after === undefined
              ? undefined
              : this.resolveDependencies(queue, request.params.after);
          const tags =
            request.params.tags === undefined
              ? undefined
              : resolveTags(this.catalog, request.params.tags);
          if (workflow !== undefined || skip !== undefined) {
            const current = queue.items.find((candidate) => candidate.id === item);
            if (current) {
              await this.ensureItem(repository, workflow ?? current.workflow, skip ?? current.skip);
            }
          }
          editItem(
            queue,
            item,
            { workflow, task, groups, title, position, autoDeliver, tags, skip, after },
            now,
          );
          this.saveQueue(queue);
          await this.advanceQueue(repository);
          return this.queueSnapshot(queue);
        }
        case 'queue_remove':
          removeItem(queue, request.params.item, now);
          return this.saveQueue(queue);
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
        case 'queue_settings':
          setParallel(queue, request.params.parallel, now);
          this.saveQueue(queue);
          await this.advanceQueue(repository);
          return this.queueSnapshot(queue);
        case 'queue_run_now': {
          const item = queue.items.find((candidate) => candidate.id === request.params.item);
          if (!item) throw new Rejection('unknown queue item');
          const created = await this.createRun(
            itemParams(queue, item),
            knownTags(this.catalog, item.tags),
            item.id,
          );
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
    return runView(
      state,
      now,
      (slug) => this.diffs.get(`${state.run.id}/${slug}`) ?? null,
      this.catalog,
    );
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
    this.subscribers.add(send);
    return () => this.subscribers.delete(send);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.executor.stopAll();
    await this.queue.catch(() => undefined);
    this.store.close();
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
    const active = [...this.states.values()].filter((state) => state.run.finishedAt === null);
    const effects = dispatch(active, this.max, this.now());
    if (effects.length === 0) return;
    for (const state of active) this.save(state);
    for (const effect of effects) {
      const state = this.states.get(effect.run);
      if (state) await this.executor.perform(state, [effect]);
    }
  }

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
        return this.event(request.params.runId, (state) => ({
          kind: 'retry',
          group: request.params.group,
          permissions: this.currentPermissions(state),
        }));
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

  private tagAdd(params: ParamsOf<'tag_add'>): TagView[] {
    const now = this.now();
    let id = tagId(now, randomInt(36 ** 3));
    while (this.catalog.some((tag) => tag.id === id)) id = tagId(now, randomInt(36 ** 3));
    const tag = addTag(this.catalog, params, id, now);
    this.store.saveTag(tag);
    this.catalog = [...this.catalog, tag];
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

  private async runTags(params: ParamsOf<'run_tags'>): Promise<RunView> {
    const state = this.state(params.runId);
    const add = resolveTags(this.catalog, params.add ?? []);
    const remove = new Set(resolveTags(this.catalog, params.remove ?? []));
    const current = knownTags(this.catalog, state.run.tags).filter((id) => !remove.has(id));
    const tags = [...current, ...add.filter((id) => !current.includes(id) && !remove.has(id))];
    await this.apply(state, { kind: 'tags_set', tags });
    return this.view(state);
  }

  /** `run`: the task goes to the end of the queue, a stopped queue is started, then the queue advances. */
  private async enqueueRun(params: ParamsOf<'run'>): Promise<RunQueued> {
    const repository = await this.rootOf(params.repository);
    const queue = this.queueFor(repository);
    const now = this.now();
    const { workflow, task, groups, title, autoDeliver, skip } = params;
    const tags = resolveTags(this.catalog, params.tags ?? []);
    const after = this.resolveDependencies(queue, params.after ?? []);
    await this.ensureItem(repository, workflow, skip);
    const item = addItem(
      queue,
      { workflow, task, groups, title, autoDeliver, tags, skip, after },
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
    return { item: item.id, run, queue: this.queueSnapshot(queue) };
  }

  private async addQueueItem(
    repository: string,
    params: Pick<
      ParamsOf<'queue_add'>,
      'workflow' | 'task' | 'groups' | 'title' | 'autoDeliver' | 'skip' | 'after'
    > &
      Pick<ParamsOf<'queue_add'>, 'tags'>,
    inherited?: string[],
  ): Promise<unknown> {
    const { workflow, task, groups, title, autoDeliver, skip } = params;
    const tags = inherited ?? resolveTags(this.catalog, params.tags ?? []);
    const queue = this.queueFor(repository);
    const now = this.now();
    const after = this.resolveDependencies(queue, params.after ?? []);
    await this.ensureItem(repository, workflow, skip);
    const item = addItem(
      queue,
      { workflow, task, groups, title, autoDeliver, tags, skip, after },
      queueItemId(now, randomInt(36 ** 3)),
      now,
    );
    this.saveQueue(queue);
    await this.advanceQueue(repository);
    return { ...this.queueSnapshot(queue), item: item.id };
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
      return this.addQueueItem(
        state.run.repository,
        params,
        knownTags(this.catalog, state.run.tags),
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
    queueItem: string | null = null,
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
      queueItem,
      autoDeliver: params.autoDeliver,
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
    return { ok: true, ...commitEdit(plan) };
  }

  private async configSetting(params: ParamsOf<'config_setting'>): Promise<ConfigEditResult> {
    const repository = await this.rootOf(params.repository);
    let plan;
    try {
      plan = planSetting(this.configPathsOf(repository), {
        path: params.path,
        value: params.value,
        revision: params.revision,
        level: params.level,
      });
    } catch (error) {
      if (error instanceof ConfigEditError) throw new Rejection(error.message);
      throw error;
    }
    if (!plan.ok) return plan;
    return { ok: true, ...commitEdit(plan) };
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
    items: view.items.map((item) => [item.id, item.readiness, item.after]),
  });
}
