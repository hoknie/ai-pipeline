import type { TranscriptEntry } from '../protocol/index.ts';
import type {
  ClaudeEditMode,
  ClaudeMcpMode,
  ClaudeSettingsSource,
  Permissions,
  Runtime as RuntimeName,
  Specialist,
} from '../config/index.ts';
import type { Denial, StepInput, Usage } from '../core/index.ts';

export interface LaunchContext {
  specialist: Specialist;
  input: StepInput;
  worktree: string;
  attemptDirectory: string;
  workerCommand: string[];
  sessionId: string;
  resumeSession: string | null;
  claudeEditMode: ClaudeEditMode;
  claudeMcp: ClaudeMcpMode;
  /** `isolated` keeps the user's own Claude Code settings (hooks, plugins, rules) away. */
  claudeSettings: ClaudeSettingsSource;
}

export interface GeneratedFile {
  path: string;
  content: string;
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
  /** Tool calls the agent CLI refused, each once. */
  denials: Denial[];
}

export interface OutputParser {
  push(line: string): void;
  outcome(): RunOutcome;
}

export interface Runtime {
  readonly name: RuntimeName;
  readonly executable: string;
  buildLaunch(context: LaunchContext): Launch;
  /** A single question to a model without tools or MCP servers; files go to `directory`. */
  buildOneShot(request: OneShotRequest): Launch;
  createParser(): OutputParser;
  /** Readable entries of an attempt log written by this runtime. */
  transcript(lines: string[]): TranscriptEntry[];
  skillDirectories(worktree: string, home: string): string[];
  /** Tools the agent CLI has without any configuration. */
  readonly builtinTools: string[];
}

export const PROTECTED_GIT_COMMANDS = ['git push', 'git checkout', 'git switch'];

export function describePermissions(permissions: Permissions): string {
  switch (permissions) {
    case 'read':
      return 'You may only read and search files. Do not try to edit files or run shell commands.';
    case 'edit':
      return 'You may edit files inside the current directory and run only the allowed shell commands.';
    case 'full':
      return 'You may edit files inside the current directory and run shell commands.';
  }
}
