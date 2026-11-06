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

/** Points of the pipeline where actions run, in the order of the pipeline. */
export const ACTION_POINTS = [
  'before_split',
  'after_split',
  'before_delivery',
  'after_delivery',
] as const;
export type ActionPoint = (typeof ACTION_POINTS)[number];

export const ACTION_FAILURES = ['stop', 'continue'] as const;
export type ActionFailure = (typeof ACTION_FAILURES)[number];

export const DEFAULT_ACTION_TIMEOUT_SECONDS = 600;

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

/** An MCP server started for one specialist, next to the `aip` server. */
export interface McpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface Specialist {
  slug: string;
  name: string;
  model: string | null;
  runtime: Runtime;
  permissions: Permissions;
  timeoutSeconds: number;
  allowCommands: string[];
  tools: string[];
  /** MCP servers of this specialist by name; absent when there are none. */
  mcp?: Record<string, McpServer>;
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

/** A pipeline action: a shell command (`run`) or a step of a specialist (`specialist`). */
export interface Action {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  run: string | null;
  specialist: string | null;
  /** Text appended to the prompt of the specialist; only with `specialist`. */
  additionalPrompt: string | null;
  /** Seconds a command may run; only with `run`. */
  timeoutSeconds: number;
  onFailure: ActionFailure;
  /** Level of the definition. */
  level: SpecialistLevel;
}

/** Ids of actions by pipeline point; a point that is absent has no value of its own. */
export type StagePoints = Partial<Record<ActionPoint, string[]>>;

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
  /** Pipeline whose steps the groups follow after the split; null: the pipeline itself. */
  pipeline: string | null;
}

export interface Pipeline {
  id: string;
  /** Display name; null: the id is shown. */
  name: string | null;
  split: Split | null;
  steps: Step[];
  /** Actions of this pipeline by point; a point replaces the one of `swarm.stages` entirely. */
  stages?: StagePoints;
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

function normalizedSplit(split: Split | null | undefined): Split | null {
  if (!split) return split ?? null;
  const { workflow, ...rest } = split as Split & { workflow?: string | null };
  return workflow === undefined ? split : { ...rest, pipeline: rest.pipeline ?? workflow };
}

/** Fills settings added after a run was stored, so older runs keep working. */
export function withConfigDefaults(config: ResolvedConfig): ResolvedConfig {
  const stored = config as Omit<
    ResolvedConfig,
    'workspace' | 'delivery' | 'actions' | 'stages' | 'pipelines'
  > & {
    pipelines?: Pipeline[];
    /** Name of the pipelines in snapshots stored by older builds. */
    workflows?: Pipeline[];
    actions?: Action[];
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
  // Runs stored before pipeline actions existed have none.
  const actions = stored.actions ?? [];
  const stages = stored.stages ?? {};
  const { workflows: _old, ...current } = stored;
  return {
    ...current,
    workspace,
    delivery,
    naming,
    web,
    runtimes,
    specialists,
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
  specialists: Specialist[];
  pipelines: Pipeline[];
  /** Pipeline actions by id. */
  actions: Action[];
  /** Actions of the pipeline points shared by the pipelines. */
  stages: StagePoints;
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

export function findAction(config: ResolvedConfig, id: string): Action | undefined {
  return (config.actions ?? []).find((action) => action.id === id);
}

/** Ids of the actions of a point of a pipeline: its own list, else the shared one. */
export function pipelineActionIds(
  config: ResolvedConfig,
  pipeline: Pipeline,
  point: ActionPoint,
): string[] {
  if (pipeline.stages?.[point] !== undefined) return pipeline.stages[point];
  // A pipeline without a split has no points around the split.
  if ((point === 'before_split' || point === 'after_split') && pipeline.split === null) return [];
  return config.stages?.[point] ?? [];
}

export function findPipeline(config: ResolvedConfig, id: string): Pipeline | undefined {
  return config.pipelines.find((pipeline) => pipeline.id === id);
}

/** Display name of a pipeline: `name`, else the id. Tolerates snapshots saved before the field existed. */
export function pipelineName(pipeline: Pipeline): string {
  return pipeline.name ?? pipeline.id;
}

/** Display name of the pipeline `id`; the id itself when there is no such pipeline. */
export function pipelineNameOf(config: ResolvedConfig, id: string): string {
  const found = findPipeline(config, id);
  return found ? pipelineName(found) : id;
}

/** The pipeline whose steps the groups of `pipeline` follow. */
export function groupPipeline(config: ResolvedConfig, pipeline: Pipeline): Pipeline {
  // Runs saved before the field existed have no value.
  const target = pipeline.split?.pipeline ?? null;
  if (target === null) return pipeline;
  const found = findPipeline(config, target);
  if (!found) throw new Error(`pipeline ${pipeline.id} splits into unknown pipeline ${target}`);
  return found;
}

export function stepIndex(pipeline: Pipeline, stepId: string): number {
  return pipeline.steps.findIndex((step) => step.id === stepId);
}

/** Slug of the specialist of the observer; it is not a slug of `swarm.yaml` (starts with `_`). */
export const OBSERVER_SPECIALIST = '_observer';

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const SLUG_PATTERN_TEXT = '^[a-z][a-z0-9-]{0,31}$';

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
