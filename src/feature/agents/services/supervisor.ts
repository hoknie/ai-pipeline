import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import { dirname } from 'node:path';
import { createInterface, type Interface } from 'node:readline';

import type { Launch, OutputParser, RunOutcome, Usage } from '../types/index.ts';

export const STOP_GRACE_MS = 10_000;
export const DRAIN_MS = 2_000;

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  outcome: RunOutcome;
  spawnError: string | null;
}

export interface SupervisedProcess {
  readonly pid: number | undefined;
  stop(): void;
  readonly exited: Promise<ProcessExit>;
}

export interface LaunchOptions {
  cwd: string;
  logPath: string;
  parser: OutputParser;
  environment: NodeJS.ProcessEnv;
  graceMs?: number;
  /** How long the output is drained after the process exited; defaults to 2 s. */
  drainMs?: number;
  /** Called when the usage of the parser changed after a line of output. */
  onUsage?: (usage: Usage) => void;
  /** When set, the moment each log line was written is appended there as `<line>\t<ms>`. */
  timesPath?: string;
}

/** Writes `<line>\t<ms>` for each new log line; does nothing without a times file. */
function lineStamper(options: LaunchOptions): (lines: number) => void {
  // Lines already in the log (an executor may have added some) keep their numbers.
  let lineCount = 0;
  if (options.timesPath) {
    try {
      for (const char of readFileSync(options.logPath, 'utf8')) if (char === '\n') lineCount += 1;
    } catch {
      lineCount = 0;
    }
  }
  return (lines) => {
    if (!options.timesPath || lines <= 0) return;
    const now = Date.now();
    let text = '';
    for (let index = 0; index < lines; index += 1) text += `${lineCount + index}\t${now}\n`;
    lineCount += lines;
    try {
      appendFileSync(options.timesPath, text);
    } catch {
      // the journal works without times
    }
  };
}

/** A process that never started: the log gets the error, the exit is ready at once. */
function failedLaunch(log: WriteStream, options: LaunchOptions, error: string): SupervisedProcess {
  const failure: ProcessExit = {
    code: null,
    signal: null,
    outcome: options.parser.outcome(),
    spawnError: error,
  };
  return {
    pid: undefined,
    stop() {},
    exited: new Promise((resolve) => {
      log.end(`[aip] spawn failed: ${error}\n`, () => resolve(failure));
    }),
  };
}

/** Writes the output to the log, feeds stdout to the parser and reports changed usage. */
function readOutput(
  child: ChildProcess,
  log: WriteStream,
  options: LaunchOptions,
  stamp: (lines: number) => void,
): Interface {
  const stdout = createInterface({ input: child.stdout! });
  let reported: Usage | null = null;
  stdout.on('line', (line) => {
    log.write(`${line}\n`);
    stamp(1);
    options.parser.push(line);
    if (!options.onUsage) return;
    const usage = options.parser.usage();
    if (
      usage !== null &&
      (reported === null ||
        reported.inputTokens !== usage.inputTokens ||
        reported.outputTokens !== usage.outputTokens ||
        reported.costUsd !== usage.costUsd)
    ) {
      reported = usage;
      options.onUsage(usage);
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    log.write(chunk);
    stamp(chunk.filter((byte) => byte === 10).length);
  });
  return stdout;
}

/** Sends a signal to the process group of the child, or to the child alone. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return;
    }
  }
}

interface Watched {
  child: ChildProcess;
  log: WriteStream;
  stdout: Interface;
  options: LaunchOptions;
  stamp: (lines: number) => void;
  killTimer: () => NodeJS.Timeout | null;
}

/** The exit of the child, resolved once its log is on disk. */
function exitOf(watched: Watched): Promise<ProcessExit> {
  const { child, log, stdout, options, stamp } = watched;
  return new Promise<ProcessExit>((resolve) => {
    let settled = false;
    let spawnError: string | null = null;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      const timer = watched.killTimer();
      if (timer) clearTimeout(timer);
      stdout.close();
      stamp(1);
      const exit = { code, signal, outcome: options.parser.outcome(), spawnError };
      // Resolved once the log is on disk: a reader after the exit sees its last line.
      log.end(
        `[aip] exited code=${code} signal=${signal}${spawnError ? ` error=${spawnError}` : ''}\n`,
        () => resolve(exit),
      );
    };
    child.once('error', (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.once('exit', (code, signal) => {
      signalGroup(child, 'SIGTERM');
      setTimeout(() => finish(code, signal), options.drainMs ?? DRAIN_MS).unref();
    });
    child.once('close', finish);
  });
}

export function launchProcess(launch: Launch, options: LaunchOptions): SupervisedProcess {
  for (const file of launch.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, { mode: 0o600 });
  }
  mkdirSync(dirname(options.logPath), { recursive: true });
  const stamp = lineStamper(options);
  const log = createWriteStream(options.logPath, { flags: 'a' });
  let child: ChildProcess;
  try {
    child = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      // PWD of the daemon names another directory; OpenCode 2 takes its project from PWD.
      env: { ...options.environment, ...launch.env, PWD: options.cwd },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    stamp(1);
    return failedLaunch(log, options, (error as Error).message);
  }
  const stdout = readOutput(child, log, options, stamp);
  let killTimer: NodeJS.Timeout | null = null;
  const exited = exitOf({ child, log, stdout, options, stamp, killTimer: () => killTimer });
  return {
    pid: child.pid,
    stop() {
      signalGroup(child, 'SIGTERM');
      killTimer ??= setTimeout(
        () => signalGroup(child, 'SIGKILL'),
        options.graceMs ?? STOP_GRACE_MS,
      );
      killTimer.unref();
    },
    exited,
  };
}
