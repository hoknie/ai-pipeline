import type { AgentsService } from '../../../agents/services/index.ts';
import type { Runtime } from '../../../agents/types/index.ts';
import type { NetworkMonitor } from '../../../network/services/index.ts';
import type { ConfigService } from '../../../swarm-config/services/index.ts';
import type { Specialist } from '../../../swarm-config/types/index.ts';
import type { Event } from '../../machine/index.ts';
import type {
  AgentExitPort,
  DiffPort,
  QueueAdvancePort,
  RunCommitsPort,
  RunPushPort,
  RegistrySkillsPort,
  RemoteMcpPort,
  RegistryProjectPort,
  RunAttachmentsPort,
  RunsPublishPort,
} from '../../ports/index.ts';
import type { Attempt, Group, RunState } from '../../types/index.ts';

/** What the effects take from the engine: the queue, `apply` and `save`. */
export interface EffectContext {
  readonly stopping: boolean;
  apply(state: RunState, event: Event): Promise<void>;
  /** Runs `work` after everything queued before it. */
  serial<T>(work: () => Promise<T>): Promise<T>;
  save(state: RunState): void;
}

/** The longest an attempt waits for the registry to name its project. */
export const REGISTRY_PROJECT_TIMEOUT_MS = 15_000;
export const NAMING_TIMEOUT_MS = 60_000;
/** The live usage of a run reaches its state at most once per interval. */
export const USAGE_INTERVAL_MS = 1_000;

/** The durations the effects wait for; tests shorten them. */
export interface EffectTimings {
  /** Length of one second of a step's `timeout`. */
  timeoutUnitMs: number;
  /** How long the output of an agent is drained after it exited. */
  drainMs: number;
  /** How often the usage of a running step is saved. */
  usageIntervalMs: number;
  /** The longest the naming agent may run. */
  namingTimeoutMs: number;
  /** The longest an attempt waits for the registry to name its project. */
  registryProjectMs: number;
}

export interface EffectDependencies {
  context: EffectContext;
  agents: AgentsService;
  config: ConfigService;
  /** The check of the network: agents start after it and learn about a failed network from it. */
  network: NetworkMonitor;
  /** Path of the daemon socket the worker MCP servers connect to. */
  socket: string;
  environment: NodeJS.ProcessEnv;
  /** The clock of the daemon, in ms. */
  now: () => number;
  /** The command that starts `aip`; the worker MCP server is started with it. */
  entry: string[];
  /** Time between the stop signal and SIGKILL for an agent. */
  graceMs: number | undefined;
  timings: EffectTimings;
  diff: DiffPort;
  agentExit: AgentExitPort;
  queue: QueueAdvancePort;
  attachments: RunAttachmentsPort;
  /** The connections the MCP servers of a specialist go through. */
  remoteMcp: RemoteMcpPort;
  /** The skills of a service registry for the specialists. */
  registrySkills: RegistrySkillsPort;
  /** The project of the service registry the project of a run is linked to. */
  registryProject: RegistryProjectPort;
  commits: RunCommitsPort;
  push: RunPushPort;
  publish: Pick<RunsPublishPort, 'logGrew'>;
}

/** The attempt of a group an agent works on. */
export interface AttemptKey {
  run: string;
  group: string;
  seq: number;
}

export function keyOf(key: AttemptKey): string {
  return `${key.run}/${key.group}/${key.seq}`;
}

/** What an attempt starts with once its runtime, tree and specialist are known. */
export interface Prepared {
  state: RunState;
  group: Group;
  attempt: Attempt;
  key: AttemptKey;
  runtime: Runtime;
  worktree: string;
  specialist: Specialist;
  /** The folder the attachments of the run are laid out in; null without attachments. */
  attachments: string | null;
}
