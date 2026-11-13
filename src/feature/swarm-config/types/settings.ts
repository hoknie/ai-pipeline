import { type Action, legacyScript, type StagePoints } from './action.ts';
import { type RuntimeChain } from './chain.ts';
import { type Pipeline, type Split, type Step } from './pipeline.ts';
import { type CatalogMcpServer } from './specialist.ts';
import { type Defaults, type Runtime, type Specialist } from './specialist.ts';

export const OUTSIDE_CHANGES = ['warn', 'stop', 'off'] as const;

export type OutsideChanges = (typeof OUTSIDE_CHANGES)[number];

export const CLAUDE_EDIT_MODES = ['allowlist', 'accept_edits', 'auto'] as const;

export type ClaudeEditMode = (typeof CLAUDE_EDIT_MODES)[number];

export const CLAUDE_MCP_MODES = ['isolated', 'inherit'] as const;

export type ClaudeMcpMode = (typeof CLAUDE_MCP_MODES)[number];

/** Whether a specialist reads the user's own Claude Code settings (hooks, plugins, rules). */
export const CLAUDE_SETTINGS_SOURCES = ['isolated', 'inherit'] as const;

export type ClaudeSettingsSource = (typeof CLAUDE_SETTINGS_SOURCES)[number];

export const DELIVERY_MODES = ['worktree', 'commit', 'branch'] as const;

export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const DEFAULT_COMMIT_MESSAGE = '{title}\n\n{groups}';

export const DEFAULT_MAX = 3;

export const DEFAULT_WORKSPACE_DIR = '.aip';

export const MAX_RANGE = [1, 32] as const;

export interface ClaudeSettings {
  editMode: ClaudeEditMode;
  mcp: ClaudeMcpMode;
  settings: ClaudeSettingsSource;
}

export interface DeliverySettings {
  mode: DeliveryMode;
  auto: boolean;
  keep: boolean;
  commitMessage: string;
  messageSpecialist: string | null;
  resolver: string | null;
  resolverRounds: number;
  /** Text appended to the task of the commit message author. */
  messagePrompt?: string;
  /** Text appended to the task of the resolver. */
  resolverPrompt?: string;
}

export const WORKSPACE_BASES = ['working_tree', 'head'] as const;

export type WorkspaceBase = (typeof WORKSPACE_BASES)[number];

export interface WorkspaceSettings {
  base: WorkspaceBase;
  include: string[];
}

export interface NamingSettings {
  enabled: boolean;
  runtime: Runtime;
  model: string;
}

export const WEB_AUTH_MODES = ['token', 'none'] as const;

export type WebAuth = (typeof WEB_AUTH_MODES)[number];

/** Addresses the web panel may listen on: loopback only. */
export const WEB_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

export type WebHost = (typeof WEB_HOSTS)[number];

export const DEFAULT_WEB_PORT = 7341;

export interface WebSettings {
  /** The daemon starts the web panel together with itself. */
  autostart: boolean;
  auth: WebAuth;
  port: number;
  host: WebHost;
}

export function defaultWeb(): WebSettings {
  return { autostart: true, auth: 'token', port: DEFAULT_WEB_PORT, host: '127.0.0.1' };
}

/** How an agent CLI is started: the command, extra leading arguments and extra environment. */
export interface RuntimeCommand {
  command: string;
  /** The value from the file; `null` when not set: the runtime is then off unless `AIP_<NAME>_BIN` is set. */
  enabled: boolean | null;
  args: string[];
  env: Record<string, string>;
}

export type RuntimeSettings = Record<Runtime, RuntimeCommand>;

export function defaultRuntimes(): RuntimeSettings {
  return {
    claude: { command: 'claude', enabled: null, args: [], env: {} },
    opencode: { command: 'opencode', enabled: null, args: [], env: {} },
    agy: { command: 'agy', enabled: null, args: [], env: {} },
  };
}

export function defaultNaming(): NamingSettings {
  return { enabled: true, runtime: 'claude', model: 'haiku' };
}

export function defaultWorkspace(): WorkspaceSettings {
  return { base: 'working_tree', include: [] };
}

export function defaultDelivery(): DeliverySettings {
  return {
    mode: 'worktree',
    auto: true,
    keep: false,
    commitMessage: DEFAULT_COMMIT_MESSAGE,
    messageSpecialist: null,
    resolver: null,
    resolverRounds: 1,
  };
}

function normalizedSplit(split: Split | null | undefined): Split | null {
  if (!split) return split ?? null;
  const { workflow, ...rest } = split as Split & { workflow?: string | null };
  return workflow === undefined ? split : { ...rest, pipeline: rest.pipeline ?? workflow };
}

/** Fills settings added after a run was stored, so older runs keep working. */
export function withConfigDefaults(config: ResolvedConfig): ResolvedConfig {
  const stored = config as Omit<
    ResolvedConfig,
    'workspace' | 'delivery' | 'actions' | 'stages' | 'pipelines' | 'chains'
  > & {
    chains?: RuntimeChain[];
    pipelines?: Pipeline[];
    /** Name of the pipelines in snapshots stored by older builds. */
    workflows?: Pipeline[];
    actions?: (Omit<Action, 'run'> & { run: string | readonly string[] | null })[];
    stages?: StagePoints;
    workspace?: Partial<WorkspaceSettings>;
    delivery: Partial<DeliverySettings>;
    naming?: Partial<NamingSettings>;
    web?: Partial<WebSettings>;
    runtimes?: Partial<RuntimeSettings>;
  };
  // Runs stored before these settings existed started from HEAD and were delivered by hand.
  const workspace: WorkspaceSettings = { base: 'head', include: [], ...stored.workspace };
  const delivery: DeliverySettings = { ...defaultDelivery(), auto: false, ...stored.delivery };
  const naming: NamingSettings = { ...defaultNaming(), ...stored.naming };
  const web: WebSettings = { ...defaultWeb(), ...stored.web };
  const defaults = defaultRuntimes();
  const runtimes: RuntimeSettings = {
    claude: { ...defaults.claude, ...stored.runtimes?.claude },
    opencode: { ...defaults.opencode, ...stored.runtimes?.opencode },
    agy: { ...defaults.agy, ...stored.runtimes?.agy },
  };
  const specialists = stored.specialists.map((specialist) => ({
    ...specialist,
    max: specialist.max ?? null,
    level: (specialist as Partial<Specialist>).level ?? 'project',
  }));
  // Runs stored before `claude.settings` existed take the default: no user settings.
  const claude: ClaudeSettings = {
    ...stored.claude,
    settings: (stored.claude as Partial<ClaudeSettings>).settings ?? 'isolated',
  };
  // Runs stored before `human_review` existed have no such steps.
  const pipelines = (stored.pipelines ?? stored.workflows ?? []).map((pipeline) => ({
    ...pipeline,
    // Snapshots of older builds name the pipeline of a split `workflow`.
    split: normalizedSplit(pipeline.split),
    steps: pipeline.steps.map((step) => ({
      ...step,
      humanReview: (step as Partial<Step>).humanReview ?? false,
    })),
  }));
  const chains = (stored.chains ?? []).map((chain) => ({
    ...chain,
    level: chain.level ?? 'project',
    enabled: chain.enabled ?? true,
    runtimes: (chain.runtimes ?? []).map((item) => ({
      ...item,
      enabled: item.enabled ?? true,
      model: item.model ?? null,
    })),
  }));
  // Runs stored before pipeline actions existed have none.
  // Runs stored while `run` could be a list keep the list: it becomes one script.
  const actions: Action[] = (stored.actions ?? []).map((action) => ({
    ...action,
    run: Array.isArray(action.run) ? legacyScript(action.run) : (action.run as string | null),
  }));
  const stages = stored.stages ?? {};
  const { workflows: _old, ...current } = stored;
  return {
    ...current,
    mcpServers: stored.mcpServers ?? {},
    workspace,
    delivery,
    naming,
    web,
    runtimes,
    specialists,
    chains,
    claude,
    pipelines,
    actions,
    stages,
  };
}

export interface ResolvedConfig {
  max: number;
  workspaceDir: string;
  workspace: WorkspaceSettings;
  naming: NamingSettings;
  /** Web panel settings; read from the global level only. */
  web: WebSettings;
  /** Agent CLI commands; read from the global level only. */
  runtimes: RuntimeSettings;
  outsideChanges: OutsideChanges;
  claude: ClaudeSettings;
  delivery: DeliverySettings;
  defaults: Defaults;
  /** Catalog of MCP servers by name. */
  mcpServers: Record<string, CatalogMcpServer>;
  specialists: Specialist[];
  chains: RuntimeChain[];
  pipelines: Pipeline[];
  /** Pipeline actions by id. */
  actions: Action[];
  /** Actions of the pipeline points shared by the pipelines. */
  stages: StagePoints;
}

/** The network check of the daemon; read from the global settings.yaml only. */
export interface NetworkSettings {
  /** The daemon checks the network and holds agents while it is down. */
  enabled: boolean;
  /** `host:port` (a TCP connection) or an `http(s)://` URL (a GET request). */
  targets: string[];
  /** Interfaces that must exist and have a non-loopback address, such as `wt0` of NetBird. */
  interfaces: string[];
  /** An `http(s)://` proxy: probes go through it and agents get it as `HTTPS_PROXY`. */
  proxy: string | null;
  /** Seconds between two checks. */
  interval: number;
  /** Seconds a probe may take. */
  timeout: number;
}

/** The usage statistics of the daemon; read from the global settings.yaml only. */
export interface StatsSettings {
  /** The daemon keeps the usage journal. */
  enabled: boolean;
  /** Project paths whose usage is not recorded and not reported. */
  exclude: string[];
  /** Reports show the cost of attempts. */
  showCost: boolean;
}

export function defaultStats(): StatsSettings {
  return { enabled: true, exclude: [], showCost: true };
}

export const DEFAULT_NETWORK_TARGET = 'https://api.anthropic.com';

export function defaultNetwork(): NetworkSettings {
  return {
    enabled: false,
    targets: [DEFAULT_NETWORK_TARGET],
    interfaces: [],
    proxy: null,
    interval: 30,
    timeout: 5,
  };
}

/** The proxy URL without login and password; text that is not a URL is returned as it is. */
export function redactProxy(proxy: string): string {
  try {
    const url = new URL(proxy);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return proxy;
  }
}
