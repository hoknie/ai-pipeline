import type { CommandRunner, RuntimeModels } from './models.ts';
import type { Denial } from './permissions.ts';
import type { StepInput } from './step-input.ts';
import type { TranscriptEntry } from './transcript.ts';
import type { Usage } from './usage.ts';
import type {
  ClaudeEditMode,
  ClaudeMcpMode,
  ClaudeSettingsSource,
  OpencodeMcpMode,
  AgyMcpMode,
  Permissions,
  Runtime as RuntimeName,
  Specialist,
} from '../../swarm-config/types/index.ts';

export interface LaunchContext {
  specialist: Specialist;
  input: StepInput;
  worktree: string;
  environment?: NodeJS.ProcessEnv;
  attemptDirectory: string;
  /** Where the attachments of the run are laid out; null for a run without attachments. */
  attachmentsDirectory?: string | null;
  /**
   * A folder with `.claude/skills/<name>` for the skills of a service registry; null: none. Only a
   * runtime with `loadsExtraSkills` is given one.
   */
  skillsDirectory?: string | null;
  workerCommand: string[];
  /** The generation of the conversation of a CLI with its own history; null for the others. */
  generation?: number | null;
  /**
   * The private folder of this conversation (run, group, step, generation, runtime), outside the
   * worktree; it outlives the attempt. Null for a runtime without conversation state.
   */
  conversationDirectory?: string | null;
  sessionId: string;
  resumeSession: string | null;
  claudeEditMode: ClaudeEditMode;
  claudeMcp: ClaudeMcpMode;
  /** `isolated` keeps the user's own Claude Code settings (hooks, plugins, rules) away. */
  claudeSettings: ClaudeSettingsSource;
  opencodeMcp?: OpencodeMcpMode;
  agyMcp?: AgyMcpMode;
  overrides?: {
    claude: Record<string, unknown>;
    opencode: Record<string, unknown>;
    agy: Record<string, unknown>;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
  /** File mode; `0600` when absent. A script a CLI executes needs `0700`. */
  mode?: number;
}

export interface OneShotRequest {
  prompt: string;
  model: string;
  directory: string;
}

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
  files: GeneratedFile[];
  sessionId: string | null;
}

export interface RunOutcome {
  sessionId: string | null;
  usage: Usage | null;
  error: string | null;
  /** A resumed conversation was replaced or lost; the attempt fails, never counts. */
  conversationError?: string | null;
  /** Tool calls the agent CLI refused, each once. */
  denials: Denial[];
  /** The agent CLI stopped because its usage limit ran out; `resetsAt` in ms or null. */
  usageLimit?: { resetsAt: number | null } | null;
  /** The CLI failed on a network error of the API (at most 200 characters); null otherwise. */
  networkError?: string | null;
  /** The last text answer of the agent; null or absent when the runtime gives none. */
  reply?: string | null;
}

export interface OutputParser {
  push(line: string): void;
  outcome(): RunOutcome;
  /** Usage so far; the same value `outcome().usage` has at the end. */
  usage(): Usage | null;
}

export interface Runtime {
  readonly name: RuntimeName;
  readonly executable: string;
  buildLaunch(context: LaunchContext): Launch;
  /** A single question to a model without tools or MCP servers; files go to `directory`. */
  buildOneShot(request: OneShotRequest): Launch;
  createParser(): OutputParser;
  /** Readable entries of an attempt log written by this runtime. */
  /** `times[i]` is the moment (ms) the daemon received `lines[i]`, when known. */
  transcript(lines: string[], times?: (number | null)[]): TranscriptEntry[];
  skillDirectories(worktree: string, home: string): string[];
  /** Whether the CLI loads skills from an additional folder given for an attempt. */
  readonly loadsExtraSkills: boolean;
  /** The models a specialist of this runtime can name; never rejects, a failure goes to `error`. */
  listModels(directory: string, run: CommandRunner): Promise<RuntimeModels>;
  /** Tools the agent CLI has without any configuration. */
  readonly builtinTools: string[];
}

export const PROTECTED_GIT_COMMANDS = ['git push', 'git checkout', 'git switch'];

export function describePermissions(
  permissions: Permissions,
  allowCommands: string[] = [],
): string {
  switch (permissions) {
    case 'read':
      return 'You may only read and search files. Do not try to edit files or run shell commands.';
    case 'edit':
      return [
        'You may edit files inside the current directory and run only the allowed shell commands.',
        allowCommands.length > 0
          ? `Allowed shell commands (\`*\` stands for the rest of the line): ${allowCommands.map((command) => `\`${command}\``).join(', ')}.`
          : 'No shell command is allowed.',
        'A chain (`&&`, `;`, `|`) runs only when every command in it is allowed, and one refused command refuses the whole call: run commands one at a time, and read files with the file tools instead of `echo` or `printf`.',
      ].join(' ');
    case 'full':
      return 'You may edit files inside the current directory and run shell commands.';
  }
}

/** Extra arguments and environment from the settings, put under those of aip. */
export interface RuntimeExtra {
  args: string[];
  env: Record<string, string>;
}

/** The endpoint of an LLM API a CLI is pointed at; the key is only the name of a variable. */
export interface Endpoint {
  baseUrl: string;
  /** The name of the environment variable that holds the key; never the key. */
  keyEnv: string;
}

const envPrefix = (runtime: RuntimeName): string => `AIP_${runtime.toUpperCase()}`;

/**
 * The own endpoint of a runtime from its environment (`AIP_<NAME>_BASE_URL`, and the name of the
 * variable with the key in `AIP_<NAME>_API_KEY_ENV`, `AIP_<NAME>_API_KEY` by default); null when no
 * base URL is set. Throws for a base URL that is not http(s).
 */
export function endpointOf(
  runtime: RuntimeName,
  environment: Record<string, string | undefined>,
): Endpoint | null {
  const prefix = envPrefix(runtime);
  const baseUrl = environment[`${prefix}_BASE_URL`]?.trim();
  if (!baseUrl) return null;
  if (!/^https?:\/\/[^\s]+$/.test(baseUrl)) {
    throw new Error(`${prefix}_BASE_URL must be an http(s) URL`);
  }
  const keyEnv = environment[`${prefix}_API_KEY_ENV`]?.trim() || `${prefix}_API_KEY`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyEnv)) {
    throw new Error(`${prefix}_API_KEY_ENV must be a variable name`);
  }
  return { baseUrl, keyEnv };
}

/**
 * The folder name of a conversation inside the folder of its group: the step, the generation and the
 * runtime. The run and the group are the folders above it.
 */
export function conversationName(stepId: string, generation: number, runtime: RuntimeName): string {
  return `${stepId.replace(/[^A-Za-z0-9_.-]/g, '_')}-g${generation}-${runtime}`;
}
