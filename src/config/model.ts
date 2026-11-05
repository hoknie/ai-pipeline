export const RUNTIMES = ['claude', 'opencode'] as const;
export type Runtime = (typeof RUNTIMES)[number];

export const PERMISSIONS = ['read', 'edit', 'full'] as const;
export type Permissions = (typeof PERMISSIONS)[number];

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
export const MAX_GROUPS_RANGE = [1, 20] as const;
export const DEFAULT_MAX_GROUPS = 5;
export const MAX_RANGE = [1, 32] as const;
export const MAX_ROUNDS_RANGE = [1, 10] as const;
export const DEFAULT_TIMEOUT_SECONDS = 30 * 60;

export interface Defaults {
  runtime: Runtime;
  permissions: Permissions;
  timeoutSeconds: number;
  allowCommands: string[];
  /** Runtime tools added to the set that the permissions give. */
  tools: string[];
}

/** Where a specialist is defined: the global aip/ directory only, or the project one. */
export type SpecialistLevel = 'global' | 'project';

export interface Specialist {
  slug: string;
  name: string;
  model: string | null;
  runtime: Runtime;
  permissions: Permissions;
  timeoutSeconds: number;
  allowCommands: string[];
  tools: string[];
  skills: string[];
  prompt: string | null;
  /** Limit of simultaneously running specialists with this slug; null means no limit. */
  max: number | null;
  /**
   * May add tasks to the queue of the repository of the run (tool `swarm_queue_add`). Absent in
   * snapshots of runs made before the field existed.
   */
  queue: boolean;
  /** Level of the definition; absent in snapshots of runs made before the field existed. */
  level: SpecialistLevel;
}

export interface OnReject {
  goto: string;
  maxRounds: number;
}

export interface Step {
  id: string;
  specialist: string;
  onReject: OnReject | null;
  /** Text appended to the prompt of the specialist in this step only. */
  additionalPrompt: string | null;
  /** After `done` the group stops for a review by a person before the next step. */
  humanReview: boolean;
}

export interface Split {
  specialist: string;
  maxGroups: number;
  /** Text appended to the prompt of the split specialist. */
  additionalPrompt: string | null;
  /** Workflow whose steps the groups follow after the split; null: the workflow itself. */
  workflow: string | null;
}

export interface Workflow {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  split: Split | null;
  steps: Step[];
}

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
  args: string[];
  env: Record<string, string>;
}

export type RuntimeSettings = Record<Runtime, RuntimeCommand>;

export function defaultRuntimes(): RuntimeSettings {
  return {
    claude: { command: 'claude', args: [], env: {} },
    opencode: { command: 'opencode', args: [], env: {} },
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

/** Fills settings added after a run was stored, so older runs keep working. */
export function withConfigDefaults(config: ResolvedConfig): ResolvedConfig {
  const stored = config as Omit<ResolvedConfig, 'workspace' | 'delivery'> & {
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
  const workflows = stored.workflows.map((workflow) => ({
    ...workflow,
    steps: workflow.steps.map((step) => ({
      ...step,
      humanReview: (step as Partial<Step>).humanReview ?? false,
    })),
  }));
  return { ...stored, workspace, delivery, naming, web, runtimes, specialists, claude, workflows };
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
  specialists: Specialist[];
  workflows: Workflow[];
}

export function defaultDefaults(): Defaults {
  return {
    runtime: 'claude',
    permissions: 'edit',
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    allowCommands: [],
    tools: [],
  };
}

export function findSpecialist(config: ResolvedConfig, slug: string): Specialist | undefined {
  return config.specialists.find((specialist) => specialist.slug === slug);
}

export function findWorkflow(config: ResolvedConfig, id: string): Workflow | undefined {
  return config.workflows.find((workflow) => workflow.id === id);
}

/** Display name of a workflow: `name`, else the id. Tolerates snapshots saved before the field existed. */
export function workflowName(workflow: Workflow): string {
  return workflow.name ?? workflow.id;
}

/** Display name of the workflow `id`; the id itself when there is no such workflow. */
export function workflowNameOf(config: ResolvedConfig, id: string): string {
  const found = findWorkflow(config, id);
  return found ? workflowName(found) : id;
}

/** The workflow whose steps the groups of `workflow` follow. */
export function groupWorkflow(config: ResolvedConfig, workflow: Workflow): Workflow {
  // Runs saved before the field existed have no value.
  const target = workflow.split?.workflow ?? null;
  if (target === null) return workflow;
  const found = findWorkflow(config, target);
  if (!found) throw new Error(`workflow ${workflow.id} splits into unknown workflow ${target}`);
  return found;
}

export function stepIndex(workflow: Workflow, stepId: string): number {
  return workflow.steps.findIndex((step) => step.id === stepId);
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const SLUG_PATTERN_TEXT = '^[a-z][a-z0-9-]{0,31}$';

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
