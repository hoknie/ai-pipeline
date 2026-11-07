export interface SetupOptions {
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  claude: boolean;
  opencode: boolean;
  plugin: boolean;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Everything that touches the machine; tests pass fakes. */
export interface SetupDeps {
  env: NodeJS.ProcessEnv;
  /** Root of this installation: the directory with package.json. */
  root: string;
  exec(bin: string, args: string[]): Promise<ExecResult>;
  find(name: string): string | null;
  realpath(path: string): string;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  exists(path: string): boolean;
}

export type CheckResult =
  | { state: 'configured' }
  | { state: 'missing' }
  | { state: 'skip'; reason: string }
  | { state: 'differs'; detail: string }
  | { state: 'error'; reason: string };

export interface SetupAction {
  id: 'prerequisites' | 'claude-mcp' | 'claude-plugin' | 'opencode-mcp';
  label: string;
  /** What the action does, in the imperative; printed for a dry run. */
  plan: string;
  check(): Promise<CheckResult>;
  /** `replace` is true when a different setting has to be overwritten (`--force`). */
  apply(replace: boolean): Promise<void>;
}

export type OutcomeStatus = 'done' | 'configured' | 'skipped' | 'differs' | 'failed' | 'planned';

export interface Outcome {
  id: SetupAction['id'];
  label: string;
  status: OutcomeStatus;
  message: string;
}

/** Whether `root` is a temporary `npx` copy of the package. */
