export const RUNTIMES = ['claude', 'opencode', 'agy'] as const;

export type Runtime = (typeof RUNTIMES)[number];

export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const PERMISSIONS = ['read', 'edit', 'full'] as const;

export type Permissions = (typeof PERMISSIONS)[number];

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
  /** OpenCode model options; absent in older snapshots and when left to the runtime. */
  variant?: string;
  reasoningEffort?: ReasoningEffort;
  /** Slug of the runtime chain; absent in older snapshots or when configured directly. */
  runtimeChain?: string | null;
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

export function defaultDefaults(): Defaults {
  return {
    runtime: 'claude',
    permissions: 'edit',
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    allowCommands: [],
    tools: [],
  };
}
