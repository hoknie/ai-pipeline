import { AppError, invalid, rejected } from '../../platform/errors/index.ts';

/**
 * What a command of the CLI needs from the process around it: the working directory, the
 * environment, the output streams and the exit code. `src/cli/main.ts` builds it from `process`;
 * tests pass their own, so a command never reaches for `process.*` itself.
 */
export interface CliIo {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Whether stdout is a terminal. */
  isTTY: boolean;
  /** Width of the terminal in columns, read once at the start; unset when unknown. */
  columns?: number;
  /** Command that runs `aip` again: the node executable and the script. */
  entry: string[];
  /** Process id printed by `aip daemon`. */
  pid: number;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Reads one answer line of the user; null when there is no input. */
  ask?(question: string): Promise<string | null>;
  /** Sets the exit code of the process . */
  setExitCode(code: number): void;
  /** Ends the process at once. */
  exit(code: number): void;
  /** Calls `handler` once when the process gets `signal`. */
  onSignal(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  /** Pause between two redraws of `aip run watch`; defaults to one second. */
  watchIntervalMs?: number;
  /** How long `aip web` waits for the panel of the daemon, and how often it looks; 5 s / 100 ms. */
  panelWaitMs?: number;
  panelPollMs?: number;
}

export function writeLine(io: CliIo, value: string): void {
  io.stdout(`${value}\n`);
}

export function failLine(io: CliIo, prefix: string, message: string): void {
  io.stderr(`${prefix}: ${message}\n`);
  io.setExitCode(1);
}

/** A wrong combination or value of command flags. */
export const usage = (message: string): AppError => invalid('cli.usage', message);

/** A step of `aip setup` that failed. */
export const setupFailure = (message: string): AppError => rejected(message, 'cli.setup');
