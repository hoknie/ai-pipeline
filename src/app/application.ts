import type { BuildInfo } from '../platform/build/index.ts';
import { databasePath, socketPath } from '../platform/paths/index.ts';
import { snapshotProcesses, type PsRow } from '../platform/process/index.ts';
import { createSecretStore, installationId, type SecretStore } from '../platform/secrets/index.ts';
import { Database } from '../platform/sqlite/index.ts';
import { createAttachmentsServices } from '../feature/attachments/services/index.ts';
import { createArtifactsServices } from '../feature/artifacts/services/index.ts';
import { createComposeServices } from '../feature/compose/services/index.ts';
import { createDeliveryServices } from '../feature/delivery/services/index.ts';
import type { IntegrationAdapterPort } from '../feature/integrations/ports/index.ts';
import type { ChannelFactoryPort } from '../feature/notifications/ports/index.ts';
import {
  createIntegrationsServices,
  type IntegrationsDependencies,
} from '../feature/integrations/services/index.ts';
import { createNetworkServices } from '../feature/network/services/index.ts';
import { createObserversServices } from '../feature/observers/services/index.ts';
import { createProcessesServices } from '../feature/processes/services/index.ts';
import { createQueueServices } from '../feature/queue/services/index.ts';
import { probeProxy } from '../feature/network/types/index.ts';
import { createReposServices } from '../feature/repos/services/index.ts';
import { createRunsServices, type RunsServices } from '../feature/runs/services/index.ts';
import { httpMcpTransport } from '../feature/service-registry/clients/http-mcp/index.ts';
import { createServiceRegistryServices } from '../feature/service-registry/services/index.ts';
import { createStatsServices } from '../feature/stats/services/index.ts';
import { createSwarmConfigServices } from '../feature/swarm-config/services/index.ts';
import { createSwarmEditServices } from '../feature/swarm-edit/services/index.ts';
import { createTagsServices } from '../feature/tags/services/index.ts';
import type { PanelControl, Request } from '../presentation/ipc/contract/index.ts';
import { handle } from '../presentation/ipc/handlers/index.ts';
import { Publisher } from '../presentation/ipc/publisher.ts';
import type { DaemonServices } from '../presentation/ipc/services.ts';
import { Snapshots } from '../presentation/ipc/snapshots.ts';

import { createActors, createIpcContext } from './actors.ts';
import { wire } from './wire.ts';
import { createAgents } from './agents.ts';
import { createNotifications, builtInAdapters } from './notifications/index.ts';
import { createLifecycle } from './lifecycle.ts';
import { DEFAULT_TIMINGS, type DaemonTimings } from './timings.ts';
import { declarePorts, type Ports } from './wiring.ts';

export interface ApplicationOptions {
  stateDirectory: string;
  entry: string[];
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Receives the messages of the daemon (a provider that cannot be reached); defaults to stderr. */
  log?: (message: string) => void;
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
  /** Channel kinds of the notifications besides the built-in ones, and the pause before a listener restarts; for tests. */
  notifications?: { kinds?: readonly ChannelFactoryPort[]; restartMs?: number };
  /** Trusted setup of the integrations; the first version builds in no adapter and uses the system store. */
  integrations?: {
    adapters?: readonly IntegrationAdapterPort[];
    secretStore?: SecretStore;
  } & Pick<
    Partial<IntegrationsDependencies>,
    'limits' | 'outboundTimeoutMs' | 'secretStep' | 'newGeneration'
  >;
}

/** The daemon as the socket serves it: the services of the features, the views, the events. */
export interface Application {
  /** Path of the daemon socket. */
  readonly socket: string;
  readonly timings: DaemonTimings;
  readonly database: Database;
  readonly services: DaemonServices;
  handle(request: Request, actor?: string): Promise<unknown>;
  subscribe(send: (line: string) => void, logs?: boolean): () => void;
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
  const { options, environment, database, now, ports } = context;
  const { agents, providers } = createAgents(environment);
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
  const serviceRegistry = createServiceRegistryServices({
    transport: httpMcpTransport,
    // read at every request, so a changed `network.proxy` applies without a restart
    proxyFor: (url) => probeProxy(url, network.proxy(), environment),
    integrations: () => integrations,
    ...{ stateDirectory: options.stateDirectory, database, repositories: registry, projects, now },
  });
  const integrations = createIntegrationsServices({
    ...{ database, registry, now },
    ...options.integrations,
    store:
      options.integrations?.secretStore ??
      createSecretStore({ stateDirectory: options.stateDirectory, environment }),
    installation: () => installationId(options.stateDirectory),
    adapters: options.integrations?.adapters ?? [...builtInAdapters(), serviceRegistry.adapter],
    operations: ports.integrations.port,
    changes: ports.integrationChanges.port,
  });
  return {
    agents,
    providers,
    config,
    network,
    registry,
    projects,
    tags,
    edits,
    shared,
    integrations,
    serviceRegistry,
  };
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
    notify: ports.notify.port,
    publish: ports.runs.port,
    diff: ports.diff.port,
    attachments: ports.attachments.port,
    remoteMcp: ports.remoteMcp.port,
    registrySkills: ports.registrySkills.port,
    registryProject: ports.registryProject.port,
    commits: ports.commits.port,
    push: ports.push.port,
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
    config,
    authors: ports.authors.port,
  });
  const { artifacts } = createArtifactsServices({
    database,
    stateDirectory: options.stateDirectory,
    runs,
    now,
    publish: ports.artifacts.port,
  });
  const { attachments } = createAttachmentsServices({
    database,
    stateDirectory: options.stateDirectory,
    now,
    config,
    s3Credentials:
      context.environment.AWS_ACCESS_KEY_ID && context.environment.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: context.environment.AWS_ACCESS_KEY_ID,
            secretAccessKey: context.environment.AWS_SECRET_ACCESS_KEY,
            ...(context.environment.AWS_SESSION_TOKEN
              ? { sessionToken: context.environment.AWS_SESSION_TOKEN }
              : {}),
          }
        : null,
    log: (message) => console.error(`[aip] ${message}`),
  });
  const queue = createQueueServices({
    ...{ database, runs, tags, registry, config, now, attachments },
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
  const notifications = createNotifications(context, lower, runs);
  const compose = createComposeServices({
    database,
    registry,
    projects,
    tags,
    states: runs.states,
    queues: queue.store,
    control: queue.control,
    observers: observersServices.observers,
    integrations: lower.integrations.connections,
    notifications: notifications.subscriptions,
    links: lower.serviceRegistry.links,
  });
  return {
    delivery,
    artifacts,
    attachments,
    queue,
    observers: observersServices.observers,
    history: observersServices.history,
    stats: { ledger, report },
    notifications,
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
  const { identity, audit, access, actorOfRequest } = createActors({
    ...context,
    config: lower.config,
    registry: lower.registry,
  });
  const services: DaemonServices = {
    now,
    ...lower,
    runs,
    processes,
    ...upper,
    identity,
    audit,
    access,
  };
  const snapshots = new Snapshots(services);
  const publisher = new Publisher(services, snapshots);
  wire(ports, services, publisher);
  wiring.check();
  const ipc = createIpcContext(services, snapshots, options);
  const lifecycle = createLifecycle(services, database, ipc.log);
  return {
    socket,
    timings,
    database,
    services,
    handle: (request, actorId) => handle(request, { ...ipc, actor: actorOfRequest(actorId) }),
    subscribe: (send, logs) => publisher.subscribe(send, logs),
    start: () => lifecycle.start(),
    stop: () => lifecycle.stop(),
  };
}
