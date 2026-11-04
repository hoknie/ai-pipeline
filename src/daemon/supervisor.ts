import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

import type { Usage } from '../core/index.ts';
import type { Launch, OutputParser, RunOutcome } from '../runtime/index.ts';

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

export function launchProcess(
  launch: Launch,
  options: {
    cwd: string;
    logPath: string;
    parser: OutputParser;
    environment: NodeJS.ProcessEnv;
    graceMs?: number;
    /** How long the output is drained after the process exited; defaults to 2 s. */
    drainMs?: number;
    /** Called when the usage of the parser changed after a line of output. */
    onUsage?: (usage: Usage) => void;
  },
): SupervisedProcess {
  for (const file of launch.files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, { mode: 0o600 });
  }
  mkdirSync(dirname(options.logPath), { recursive: true });
  const log = createWriteStream(options.logPath, { flags: 'a' });
  let child: ChildProcess;
  let spawnError: string | null = null;
  try {
    child = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      env: { ...options.environment, ...launch.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    spawnError = (error as Error).message;
    log.end(`[aip] spawn failed: ${spawnError}\n`);
    return {
      pid: undefined,
      stop() {},
      exited: Promise.resolve({
        code: null,
        signal: null,
        outcome: options.parser.outcome(),
        spawnError,
      }),
    };
  }
  const stdout = createInterface({ input: child.stdout! });
  let reported: Usage | null = null;
  stdout.on('line', (line) => {
    log.write(`${line}\n`);
    options.parser.push(line);
    if (options.onUsage) {
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
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => log.write(chunk));
  let killTimer: NodeJS.Timeout | null = null;
  const signalGroup = (signal: NodeJS.Signals) => {
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
  };
  const exited = new Promise<ProcessExit>((resolve) => {
    let settled = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      stdout.close();
      log.end(
        `[aip] exited code=${code} signal=${signal}${spawnError ? ` error=${spawnError}` : ''}\n`,
      );
      resolve({ code, signal, outcome: options.parser.outcome(), spawnError });
    };
    child.once('error', (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.once('exit', (code, signal) => {
      signalGroup('SIGTERM');
      setTimeout(() => finish(code, signal), options.drainMs ?? DRAIN_MS).unref();
    });
    child.once('close', finish);
  });
  return {
    pid: child.pid,
    stop() {
      signalGroup('SIGTERM');
      killTimer ??= setTimeout(() => signalGroup('SIGKILL'), options.graceMs ?? STOP_GRACE_MS);
      killTimer.unref();
    },
    exited,
  };
}
