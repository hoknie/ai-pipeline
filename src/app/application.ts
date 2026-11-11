import { currentBuild, type BuildInfo } from '../platform/build/index.ts';
import { databasePath, socketPath } from '../platform/paths/index.ts';
import { snapshotProcesses, type PsRow } from '../platform/process/index.ts';
import { Database } from '../platform/sqlite/index.ts';
import { createArtifactsServices } from '../feature/artifacts/services/index.ts';
import { createComposeServices } from '../feature/compose/services/index.ts';
import { createDeliveryServices } from '../feature/delivery/services/index.ts';
import { createNetworkServices } from '../feature/network/services/index.ts';
import { createObserversServices } from '../feature/observers/services/index.ts';
import { createProcessesServices } from '../feature/processes/services/index.ts';
import { createQueueServices } from '../feature/queue/services/index.ts';
import { createReposServices } from '../feature/repos/services/index.ts';
import { createRunsServices, type RunsServices } from '../feature/runs/services/index.ts';
import { createStatsServices } from '../feature/stats/services/index.ts';
import { createSwarmConfigServices } from '../feature/swarm-config/services/index.ts';
import { createSwarmEditServices } from '../feature/swarm-edit/services/index.ts';
import { createTagsServices } from '../feature/tags/services/index.ts';
import type { PanelControl, Request } from '../presentation/ipc/contract/index.ts';
import { handle } from '../presentation/ipc/handlers/index.ts';
import { Publisher } from '../presentation/ipc/publisher.ts';
import type { DaemonServices } from '../presentation/ipc/services.ts';
import { Snapshots } from '../presentation/ipc/snapshots.ts';

import { createAgents } from './agents.ts';
import { createLifecycle } from './lifecycle.ts';
import { DEFAULT_TIMINGS, type DaemonTimings } from './timings.ts';
import { declarePorts, type Ports } from './wiring.ts';

export interface ApplicationOptions {
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

/** The daemon as the socket serves it: the services of the features, the views, the events. */
export interface Application {
  /** Path of the daemon socket. */
  readonly socket: string;
  readonly timings: DaemonTimings;
  readonly database: Database;
  readonly services: DaemonServices;
  handle(request: Request): Promise<unknown>;
  subscribe(send: (line: string) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface Context {
  options: ApplicationOptions;
  environment: NodeJS.ProcessEnv;
  timings: DaemonTimings;
  database: Database;
  socket: string;
  now: () => number;
  ports: Ports;
}

/** The features below the runs: configuration, agents, the registry, tags and their editor. */
function createLower(context: Context) {
  const { environment, database, now, ports } = context;
  const { agents } = createAgents(environment);
  const { config } = createSwarmConfigServices({ environment });
  const { monitor: network } = createNetworkServices({
    config,
    now,
    changed: ports.network.port,
    environment,
  });
  const { registry, projects } = createReposServices({ database, now, publish: ports.repos.port });
  const { catalog: tags } = createTagsServices({
    database,
    registry,
    now,
    publish: ports.tags.port,
  });
  const { edits, shared } = createSwarmEditServices({
    config,
    registry,
    agents,
    changed: ports.config.port,
  });
  return { agents, config, network, registry, projects, tags, edits, shared };
}

type Lower = ReturnType<typeof createLower>;

/** The runs and the background processes: each needs the other, the processes get closures. */
function createRuns(context: Context, lower: Lower) {
  const { options, timings, ports } = context;
  let runs: RunsServices | null = null;
  const built = (): RunsServices => {
    if (runs === null) throw new Error('the runs are not built yet');
    return runs;
  };
  const { processes } = createProcessesServices({
    roots: () => built().effects.agentRoots(),
    lookup: (id) => built().states.lookup(id),
    stopping: () => built().engine.stopping,
    takeProcesses: options.snapshotProcesses ?? (() => snapshotProcesses()),
    intervalMs: options.processesIntervalMs ?? timings.processStreamMs,
    cacheMs: timings.processCacheMs,
    killLookMs: timings.processKillLookMs,
    killGraceMs: timings.killGraceMs,
    publish: ports.processes.port,
  });
  runs = createRunsServices({
    ...context,
    ...lower,
    entry: options.entry,
    graceMs: options.graceMs ?? timings.stopGraceMs,
    queue: ports.queue.port,
    observe: ports.observe.port,
    publish: ports.runs.port,
    diff: ports.diff.port,
    agentExit: processes,
  });
  return { runs, processes };
}

/** The features above the runs, in the order of the graph. */
function createUpper(context: Context, lower: Lower, runs: RunsServices) {
  const { options, database, now, ports } = context;
  const { config, registry, projects, tags } = lower;
  const delivery = createDeliveryServices({
    database,
    stateDirectory: options.stateDirectory,
    runs,
    now,
    publish: ports.delivery.port,
  });
  const { artifacts } = createArtifactsServices({
    database,
    stateDirectory: options.stateDirectory,
    runs,
    now,
    publish: ports.artifacts.port,
  });
  const queue = createQueueServices({
    ...{ database, runs, tags, registry, config, now },
    repair: ports.repair.port,
    observe: ports.observe.port,
    publish: ports.queuePublish.port,
  });
  const observersServices = createObserversServices({
    ...{ database, runs, queue, registry, config, now },
    publish: ports.observers.port,
  });
  const { ledger, report } = createStatsServices({
    database,
    config,
    registry,
    states: runs.states,
    now,
    settingsCacheMs: context.timings.statsSettingsMs,
  });
  const compose = createComposeServices({
    database,
    registry,
    projects,
    tags,
    states: runs.states,
    queues: queue.store,
    control: queue.control,
    observers: observersServices.observers,
  });
  return {
    delivery,
    artifacts,
    queue,
    observers: observersServices.observers,
    history: observersServices.history,
    stats: { ledger, report },
    compose,
  };
}

/** The one place that creates the database, the services of the features and the transport. */
export function createApplication(options: ApplicationOptions): Application {
  const environment = options.environment ?? process.env;
  const timings: DaemonTimings = { ...DEFAULT_TIMINGS, ...options.timings };
  const database = new Database(databasePath(options.stateDirectory));
  const socket = socketPath(options.stateDirectory);
  const now = options.now ?? Date.now;
  const { wiring, ports } = declarePorts();
  const context: Context = { options, environment, timings, database, socket, now, ports };
  const lower = createLower(context);
  const { runs, processes } = createRuns(context, lower);
  const upper = createUpper(context, lower, runs);
  const services: DaemonServices = { now, ...lower, runs, processes, ...upper };
  const snapshots = new Snapshots(services);
  const publisher = new Publisher(services, snapshots);
  wire(ports, services, publisher);
  wiring.check();
  const lifecycle = createLifecycle(services, database);
  const ipc = { services, snapshots, build: options.build ?? currentBuild(), panel: options.panel };
  return {
    socket,
    timings,
    database,
    services,
    handle: (request) => handle(request, ipc),
    subscribe: (send) => publisher.subscribe(send),
    start: () => lifecycle.start(),
    stop: () => lifecycle.stop(),
  };
}

/** Sets every port against the arrows: the publisher, the queue, the observers and the diffs. */
function wire(ports: Ports, services: DaemonServices, publisher: Publisher): void {
  const publications = publisher.ports();
  ports.repos.set(publications.repos);
  ports.tags.set(publications.tags);
  ports.config.set(publications.config);
  ports.processes.set(publications.processes);
  // Every saved run reaches the clients first, then the usage journal.
  ports.runs.set({
    ...publications.runs,
    runSaved: (state) => {
      publications.runs.runSaved(state);
      void services.stats.ledger.capture(state);
    },
  });
  ports.queuePublish.set(publications.queue);
  ports.observers.set(publications.observers);
  ports.delivery.set(publications.delivery);
  ports.artifacts.set(publications.artifacts);
  // Agents held for the network start, and the clients hear about it, as soon as it changes.
  ports.network.set({
    changed: (state) => {
      publications.network.changed(state);
      const { engine } = services.runs;
      void engine.serial(() => engine.wake()).catch(() => undefined);
    },
  });
  ports.queue.set(services.queue.advance);
  ports.observe.set(services.observers);
  ports.repair.set(services.observers);
  ports.diff.set({
    savePatch: (state) => services.delivery.patches.save(state),
    refreshDiff: (state, slug) => services.delivery.diffs.refresh(state, slug),
  });
}
