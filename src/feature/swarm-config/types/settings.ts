import { type Action, legacyScript, type StagePoints } from './action.ts';
import { type RuntimeChain } from './chain.ts';
import { type Pipeline, type Split, type Step } from './pipeline.ts';
import { type Provider, type Role, withRegistryDefaults } from './providers/provider.ts';
import { type CatalogMcpServer } from './specialist.ts';
import { type Defaults, type Runtime, type Specialist } from './specialist.ts';

export const OUTSIDE_CHANGES = ['warn', 'stop', 'off'] as const;

export type OutsideChanges = (typeof OUTSIDE_CHANGES)[number];

export const CLAUDE_EDIT_MODES = ['allowlist', 'accept_edits', 'auto'] as const;

export type ClaudeEditMode = (typeof CLAUDE_EDIT_MODES)[number];

export const CLAUDE_MCP_MODES = ['isolated', 'inherit'] as const;

export type ClaudeMcpMode = (typeof CLAUDE_MCP_MODES)[number];

export const OPENCODE_MCP_MODES = ['inherit', 'isolated'] as const;
export const AGY_MCP_MODES = ['isolated', 'inherit'] as const;
export type OpencodeMcpMode = (typeof OPENCODE_MCP_MODES)[number];
export type AgyMcpMode = (typeof AGY_MCP_MODES)[number];

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
  overrides: Record<string, unknown>;
}

export interface OpencodeSettings {
  mcp: OpencodeMcpMode;
  overrides: Record<string, unknown>;
}

export interface AgySettings {
  mcp: AgyMcpMode;
  overrides: Record<string, unknown>;
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
    codex: { command: 'codex', enabled: null, args: [], env: {} },
    kilo: { command: 'kilo', enabled: null, args: [], env: {} },
    cline: { command: 'cline', enabled: null, args: [], env: {} },
    copilot: { command: 'copilot', enabled: null, args: [], env: {} },
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

/** The commands of every runtime; a snapshot of an older build lacks the runtimes added since. */
function runtimesWithDefaults(stored: Partial<RuntimeSettings> | undefined): RuntimeSettings {
  const defaults = defaultRuntimes();
  return Object.fromEntries(
    (Object.keys(defaults) as Runtime[]).map((name) => [
      name,
      { ...defaults[name], ...stored?.[name] },
    ]),
  ) as RuntimeSettings;
}

/** A configuration as a snapshot of an older build may have stored it. */
type StoredConfig = Omit<
  ResolvedConfig,
  | 'workspace'
  | 'delivery'
  | 'actions'
  | 'stages'
  | 'pipelines'
  | 'chains'
  | 'opencode'
  | 'agy'
  | 'providers'
  | 'roles'
> & {
  chains?: RuntimeChain[];
  providers?: Provider[];
  roles?: Role[];
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
  opencode?: Partial<OpencodeSettings>;
  agy?: Partial<AgySettings>;
};

/** Fills settings added after a run was stored, so older runs keep working. */
export function withConfigDefaults(config: ResolvedConfig): ResolvedConfig {
  const stored = config as StoredConfig;
  // Runs stored before these settings existed started from HEAD and were delivered by hand.
  const workspace: WorkspaceSettings = { base: 'head', include: [], ...stored.workspace };
  const delivery: DeliverySettings = { ...defaultDelivery(), auto: false, ...stored.delivery };
  const naming: NamingSettings = { ...defaultNaming(), ...stored.naming };
  const web: WebSettings = { ...defaultWeb(), ...stored.web };
  const runtimes = runtimesWithDefaults(stored.runtimes);
  const specialists = stored.specialists.map((specialist) => ({
    ...specialist,
    max: specialist.max ?? null,
    level: (specialist as Partial<Specialist>).level ?? 'project',
  }));
  // Runs stored before `claude.settings` existed take the default: no user settings.
  const claude: ClaudeSettings = {
    ...stored.claude,
    settings: (stored.claude as Partial<ClaudeSettings>).settings ?? 'isolated',
    overrides: (stored.claude as Partial<ClaudeSettings>).overrides ?? {},
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
    ...withRegistryDefaults(stored),
    claude,
    opencode: { mcp: 'inherit', overrides: {}, ...stored.opencode },
    agy: { mcp: 'isolated', overrides: {}, ...stored.agy },
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
  opencode: OpencodeSettings;
  agy: AgySettings;
  delivery: DeliverySettings;
  defaults: Defaults;
  /** Catalog of MCP servers by name. */
  mcpServers: Record<string, CatalogMcpServer>;
  specialists: Specialist[];
  chains: RuntimeChain[];
  /** Providers of the providers/ directories: the registry of the known providers. */
  providers: Provider[];
  /** Roles of the models, in the order of settings.yaml. */
  roles: Role[];
  pipelines: Pipeline[];
  /** Pipeline actions by id. */
  actions: Action[];
  /** Actions of the pipeline points shared by the pipelines. */
  stages: StagePoints;
}

export * from './machine/machine-settings.ts';

export const DEFAULT_SERVER_LISTEN = `127.0.0.1:${DEFAULT_WEB_PORT}`;

/** The server mode of the daemon; read from the global settings.yaml only. */
export interface ServerSettings {
  /** One shared daemon serves several people over the network. */
  enabled: boolean;
  /** `<address>:<port>` the panel listens on. */
  listen: string;
  /** The external address (scheme and host, no path); `null` while unset. */
  publicUrl: string | null;
  /** Addresses of reverse proxies whose `X-Forwarded-*` headers are trusted. */
  trustedProxies: string[];
  /** Lifetime of a panel session: `<n>h` or `<n>d`. */
  sessionTtl: string;
  /** The longest lifetime of a personal token: `<n>d`. */
  tokenMaxTtl: string;
}

export function defaultServer(): ServerSettings {
  return {
    enabled: false,
    listen: DEFAULT_SERVER_LISTEN,
    publicUrl: null,
    trustedProxies: [],
    sessionTtl: '12h',
    tokenMaxTtl: '90d',
  };
}
