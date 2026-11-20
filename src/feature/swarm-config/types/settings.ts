import { type AccessRole } from './access/index.ts';
import { type Action, legacyScript, type StagePoints } from './action.ts';
import { type RuntimeChain } from './chain.ts';
import { type Pipeline, type Split, type Step } from './pipeline.ts';
import { type Provider, type Role, withRegistryDefaults } from './providers/provider.ts';
import { type CatalogMcpServer } from './specialist.ts';
import { DEFAULT_WEB_PORT, defaultWeb, type WebSettings } from './web/index.ts';
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

export const DEFAULT_REMOTE = 'origin';

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
  /** Send the branch `aip/<run>` of a delivery to `remote`. */
  push: boolean;
  /** The remote repository of a delivery. */
  remote: string;
  /** The main branch of `remote` a run starts from in the server mode; `undefined`: its `HEAD`. */
  baseBranch?: string;
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

export * from './web/index.ts';

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
    push: false,
    remote: DEFAULT_REMOTE,
  };
}

/** The delivery defaults of the server mode: only a branch, sent to the remote. */
export function serverDelivery(): DeliverySettings {
  return { ...defaultDelivery(), mode: 'branch', push: true };
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
  /** External sign-in providers; none while unset. */
  sso: SsoSettings;
  /** How long the audit journal keeps an entry: `<n>d`. */
  auditRetention: string;
  /** `Name <email>` added as a co-author to the commits of a delivery; `null`: none. */
  commitTrailer: string | null;
  /** The role (`admin`, `developer`, `viewer`) of a user without the attribute `role`; `null`: none. */
  defaultRole: AccessRole | null;
}

/** The OpenID Connect provider of `server.sso.oidc`. */
export interface OidcSettings {
  /** The issuer URL; its discovery document is `<issuer>/.well-known/openid-configuration`. */
  issuer: string;
  clientId: string;
  /** The name of the daemon environment variable that holds the client secret. */
  clientSecretEnv: string;
  scopes: string[];
  /** The caption of the sign-in button. */
  label: string;
  /** The names of the claims of the email and of the name. */
  claims: { email: string; name: string };
  /** The user attribute name → the claim it is taken from. */
  attributes: Record<string, string>;
  /** Only emails of these domains may sign in; empty means any. */
  allowedDomains: string[];
}

/** The SAML 2.0 provider of `server.sso.saml`. */
export interface SamlSettings {
  /** The metadata of the provider: an http(s) URL or a path of a file. */
  idpMetadata: string;
  /** The entityID of the service; `null` means `<public_url>/auth/saml/metadata`. */
  entityId: string | null;
  /** The files with the private key and the certificate the service signs with. */
  keyFile: string;
  certFile: string;
  label: string;
  /** The attributes of the email and of the name; `null` email means the NameID. */
  claims: { email: string | null; name: string | null };
  /** The user attribute name → the SAML attribute it is taken from. */
  attributes: Record<string, string>;
  /** Links a user of the provider to the local account of the same email. */
  trustEmail: boolean;
  allowedDomains: string[];
}

/** The entityID of the service: the setting, else the address of its metadata. */
export function samlEntityId(saml: SamlSettings, publicUrl: string): string {
  return saml.entityId ?? `${publicUrl}/auth/saml/metadata`;
}

export interface SsoSettings {
  oidc: OidcSettings | null;
  saml: SamlSettings | null;
}

export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'];

export function defaultServer(): ServerSettings {
  return {
    enabled: false,
    listen: DEFAULT_SERVER_LISTEN,
    publicUrl: null,
    trustedProxies: [],
    sessionTtl: '12h',
    tokenMaxTtl: '90d',
    sso: { oidc: null, saml: null },
    auditRetention: '365d',
    commitTrailer: null,
    defaultRole: null,
  };
}
