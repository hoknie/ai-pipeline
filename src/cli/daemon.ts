import type { Command } from 'commander';

import { lockPath } from '../config/index.ts';
import { AlreadyRunning, startDaemon } from '../daemon/index.ts';
import {
  checkDaemon,
  daemonMismatchMessage,
  pingDaemon,
  stopDaemon,
  type DaemonCheck,
  type PingResult,
  type Style,
} from '../protocol/index.ts';

import { context, daemon } from './commands.ts';
import { examples } from './help.ts';
import { createDaemonPanel } from './web/daemon-panel.ts';

/** Exit code of `aip daemon status` when no daemon runs. */
export const EXIT_NOT_RUNNING = 3;

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  version: string | null;
  build: string | null;
  busy: boolean | null;
  socket: string;
  mismatch: 'daemon' | 'client' | null;
}

export function daemonStatus(
  ping: PingResult | null,
  check: DaemonCheck | null,
  socket: string,
): DaemonStatus {
  return {
    running: ping !== null,
    pid: ping?.pid ?? null,
    version: ping?.build?.version ?? null,
    build: ping?.build?.fingerprint ?? null,
    busy: ping === null ? null : (ping.busy ?? null),
    socket,
    mismatch: check?.mismatch?.outdated ?? null,
  };
}

/** Text of `aip daemon status`; `warning` is the mismatch message, if any. */
export function formatDaemonStatus(status: DaemonStatus, warning: string | null = null): string {
  if (!status.running) return 'aip daemon: not running';
  const lines = [
    `aip daemon: running${status.pid === null ? '' : ` (pid ${status.pid})`}`,
    `version: ${status.version ?? 'unknown'}`,
    `build: ${status.build ?? 'unknown'}`,
    `busy: ${status.busy === null ? 'unknown' : status.busy ? 'yes' : 'no'}`,
    `socket: ${status.socket}`,
  ];
  if (warning) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

function print(value: string): void {
  process.stdout.write(`${value}\n`);
}

function fail(message: string): void {
  process.stderr.write(`aip daemon: ${message}\n`);
  process.exitCode = 1;
}

export function registerDaemon(program: Command, style: Style): void {
  const command = program
    .command('daemon')
    .description('Run the aip daemon in the foreground, or control the background one')
    .addHelpText('after', examples(['aip daemon', 'aip daemon status'], style))
    .action(async () => {
      const ctx = context();
      try {
        const panel = createDaemonPanel({
          stateDirectory: ctx.stateDirectory,
          socket: ctx.socket,
        });
        const running = await startDaemon({
          stateDirectory: ctx.stateDirectory,
          entry: ctx.entry,
          panel,
        });
        const stop = () => void running.close();
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
        print(`aip daemon listening on ${ctx.socket} (pid ${process.pid})`);
        const started = await panel.autostart();
        if (started !== null) print(`aip web: ${started.url}`);
        await running.closed;
        await panel.close();
      } catch (error) {
        if (error instanceof AlreadyRunning) {
          fail(error.message);
          return;
        }
        throw error;
      }
    });

  command
    .command('start')
    .description('Start the daemon in the background (nothing happens if it runs)')
    .addHelpText('after', examples(['aip daemon start'], style))
    .action(async () => {
      const ctx = context();
      const check = await daemon(ctx, 'aip daemon start');
      const ping = await pingDaemon(ctx.socket);
      const pid = ping?.pid ?? 'unknown';
      print(`aip daemon: ${check.started ? 'started' : 'already running'} (pid ${pid})`);
    });

  command
    .command('stop')
    .description('Stop the daemon; refuses while agents run unless --force')
    .option('--force', 'stop the daemon together with its running agents')
    .addHelpText('after', examples(['aip daemon stop', 'aip daemon stop --force'], style))
    .action(async (options: { force?: boolean }) => {
      const ctx = context();
      const result = await stopDaemon(ctx.socket, {
        force: options.force,
        lockPath: lockPath(ctx.stateDirectory),
      });
      reportStop(result);
    });

  command
    .command('restart')
    .description('Stop the daemon and start it again; refuses while agents run unless --force')
    .option('--force', 'stop the daemon together with its running agents')
    .addHelpText('after', examples(['aip daemon restart', 'aip daemon restart --force'], style))
    .action(async (options: { force?: boolean }) => {
      const ctx = context();
      const result = await stopDaemon(ctx.socket, {
        force: options.force,
        lockPath: lockPath(ctx.stateDirectory),
      });
      if (result.state === 'busy') {
        reportStop(result);
        return;
      }
      await daemon(ctx, 'aip daemon restart');
      const ping = await pingDaemon(ctx.socket);
      const word = result.state === 'stopped' ? 'restarted' : 'started';
      print(`aip daemon: ${word} (pid ${ping?.pid ?? 'unknown'})`);
    });

  command
    .command('status')
    .description('Show whether the daemon runs (exit code 3 when it does not)')
    .option('--json', 'print JSON on one line')
    .addHelpText('after', examples(['aip daemon status', 'aip daemon status --json'], style))
    .action(async (options: { json?: boolean }) => {
      const ctx = context();
      const ping = await pingDaemon(ctx.socket);
      const check = ping === null ? null : await checkDaemon(ctx.socket);
      const status = daemonStatus(ping, check, ctx.socket);
      const warning = check ? daemonMismatchMessage(check, 'aip') : null;
      print(options.json ? JSON.stringify(status) : formatDaemonStatus(status, warning));
      if (!status.running) process.exitCode = EXIT_NOT_RUNNING;
    });
}

function reportStop(result: Awaited<ReturnType<typeof stopDaemon>>): void {
  if (result.state === 'not_running') {
    print('aip daemon: not running');
  } else if (result.state === 'busy') {
    fail(
      `busy${result.pid === null ? '' : ` (pid ${result.pid})`}: agents are running; ` +
        `use --force to stop the daemon with them`,
    );
  } else {
    print(`aip daemon: stopped (pid ${result.pid ?? 'unknown'})`);
  }
}
