import type { Command } from 'commander';

import { configPaths, loadWebSettings } from '../../../feature/swarm-config/services/index.ts';
import { lockPath } from '../../../platform/paths/index.ts';
import type { Style } from '../../format/index.ts';
import {
  checkDaemon,
  daemonMismatchMessage,
  pingDaemon,
  stopDaemon,
  subscribe,
} from '../../ipc/client/index.ts';
import type { DaemonCheck, PingResult } from '../../ipc/contract/index.ts';
import { createDaemonPanel, runStandbyPanel } from '../../web/index.ts';
import { context, daemon } from '../context.ts';
import { examples } from '../help.ts';
import { failLine, writeLine, type CliIo } from '../io.ts';
import { startPanel } from '../web-control.ts';

/** Reads the `web` section of the settings of the directory the command runs in. */
const settingsReader = (io: CliIo) => () =>
  loadWebSettings(configPaths(io.cwd, io.env.XDG_CONFIG_HOME, io.env.HOME));

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

/** `aip daemon`: runs the daemon in the foreground together with the web panel. */
async function runForeground(io: CliIo, style: Style): Promise<void> {
  const ctx = context(io, style);
  const print = (value: string): void => writeLine(io, value);
  // Imported on demand: the other daemon subcommands and every other command stay light.
  const { AlreadyRunning, startDaemon } = await import('../../../app/index.ts');
  try {
    const panel = createDaemonPanel({
      stateDirectory: ctx.stateDirectory,
      socket: ctx.socket,
      entry: ctx.entry,
      environment: io.env,
      readSettings: settingsReader(io),
      pid: io.pid,
      log: (line) => io.stderr(`${line}\n`),
    });
    const running = await startDaemon({
      stateDirectory: ctx.stateDirectory,
      entry: ctx.entry,
      environment: io.env,
      panel,
    });
    const stop = () => void running.close();
    io.onSignal('SIGTERM', stop);
    io.onSignal('SIGINT', stop);
    print(`aip daemon listening on ${ctx.socket} (pid ${io.pid})`);
    const started = await panel.autostart();
    if (started !== null) print(`aip web: ${started.url}`);
    await running.closed;
    await panel.close();
  } catch (error) {
    if (error instanceof AlreadyRunning) {
      failLine(io, 'aip daemon', error.message);
      return;
    }
    throw error;
  }
}

/** Prints the outcome of a stop request. */
function reportStop(io: CliIo, result: Awaited<ReturnType<typeof stopDaemon>>): void {
  if (result.state === 'not_running') {
    writeLine(io, 'aip daemon: not running');
  } else if (result.state === 'busy') {
    failLine(
      io,
      'aip daemon',
      `busy${result.pid === null ? '' : ` (pid ${result.pid})`}: agents are running; ` +
        `use --force to stop the daemon with them`,
    );
  } else {
    writeLine(io, `aip daemon: stopped (pid ${result.pid ?? 'unknown'})`);
  }
}

function registerStart(command: Command, style: Style, io: CliIo): void {
  const print = (value: string): void => writeLine(io, value);
  command
    .command('start')
    .description('Start the daemon in the background (nothing happens if it runs)')
    .addHelpText('after', examples(['aip daemon start'], style))
    .action(async () => {
      const ctx = context(io, style);
      const check = await daemon(ctx, 'aip daemon start');
      const ping = await pingDaemon(ctx.socket);
      const pid = ping?.pid ?? 'unknown';
      print(`aip daemon: ${check.started ? 'started' : 'already running'} (pid ${pid})`);
    });
}

function registerStop(command: Command, style: Style, io: CliIo): void {
  const print = (value: string): void => writeLine(io, value);
  command
    .command('stop')
    .description('Stop the daemon; refuses while agents run unless --force')
    .option('--force', 'stop the daemon together with its running agents')
    .option(
      '--web',
      'keep serving the web panel in this process while the daemon is stopped; it hands the panel back once the daemon starts',
    )
    .addHelpText(
      'after',
      examples(['aip daemon stop', 'aip daemon stop --force', 'aip daemon stop --web'], style),
    )
    .action(async (options: { force?: boolean; web?: boolean }) => {
      const ctx = context(io, style);
      const result = await stopDaemon(ctx.socket, {
        force: options.force,
        lockPath: lockPath(ctx.stateDirectory),
      });
      reportStop(io, result);
      if (!options.web || result.state === 'busy') return;
      const end = await runStandbyPanel({
        socket: ctx.socket,
        stateDirectory: ctx.stateDirectory,
        entry: ctx.entry,
        environment: io.env,
        readSettings: settingsReader(io),
        pid: io.pid,
        log: (line) => io.stderr(`${line}\n`),
        stop: new Promise<void>((resolve) => {
          io.onSignal('SIGTERM', resolve);
          io.onSignal('SIGINT', resolve);
        }),
        onListening: (url) =>
          print(`aip web: ${url} (the daemon is stopped; Start brings it back)`),
      });
      print(end === 'handed_over' ? 'aip web: handed over to the daemon' : 'aip web: stopped');
    });
}

function registerRestart(command: Command, style: Style, io: CliIo): void {
  const print = (value: string): void => writeLine(io, value);
  command
    .command('restart')
    .description('Stop the daemon and start it again; refuses while agents run unless --force')
    .option('--force', 'stop the daemon together with its running agents')
    .option('--web', 'also start the web panel of the new daemon, whatever web.autostart says')
    .addHelpText(
      'after',
      examples(
        ['aip daemon restart', 'aip daemon restart --force', 'aip daemon restart --web'],
        style,
      ),
    )
    .action(async (options: { force?: boolean; web?: boolean }) => {
      const ctx = context(io, style);
      const result = await stopDaemon(ctx.socket, {
        force: options.force,
        lockPath: lockPath(ctx.stateDirectory),
      });
      if (result.state === 'busy') {
        reportStop(io, result);
        return;
      }
      await daemon(ctx, 'aip daemon restart');
      const ping = await pingDaemon(ctx.socket);
      const word = result.state === 'stopped' ? 'restarted' : 'started';
      print(`aip daemon: ${word} (pid ${ping?.pid ?? 'unknown'})`);
      if (options.web)
        await startPanel(io, style, { restart: false, open: false, client: 'aip daemon restart' });
    });
}

function registerStatus(command: Command, style: Style, io: CliIo): void {
  const print = (value: string): void => writeLine(io, value);
  command
    .command('status')
    .description('Show whether the daemon runs (exit code 3 when it does not)')
    .option('--json', 'print JSON on one line')
    .addHelpText('after', examples(['aip daemon status', 'aip daemon status --json'], style))
    .action(async (options: { json?: boolean }) => {
      const ctx = context(io, style);
      const ping = await pingDaemon(ctx.socket);
      const check = ping === null ? null : await checkDaemon(ctx.socket);
      const status = daemonStatus(ping, check, ctx.socket);
      const warning = check ? daemonMismatchMessage(check, 'aip') : null;
      print(options.json ? JSON.stringify(status) : formatDaemonStatus(status, warning));
      if (!status.running) io.setExitCode(EXIT_NOT_RUNNING);
    });
}

export function registerDaemon(program: Command, style: Style, io: CliIo): void {
  const command = program
    .command('daemon')
    .description('Run the aip daemon in the foreground, or control the background one')
    .addHelpText('after', examples(['aip daemon', 'aip daemon status'], style))
    .action(() => runForeground(io, style));
  registerStart(command, style, io);
  registerStop(command, style, io);
  registerRestart(command, style, io);
  registerStatus(command, style, io);
}

/** `aip events`: the change stream of the daemon as JSON lines. */
export function registerEvents(program: Command, io: CliIo, style: Style): void {
  const print = (value: string): void => writeLine(io, value);
  program
    .command('events')
    .description('Stream changes of runs as JSON lines: a snapshot first, then one line per change')
    .option('--json', 'print JSON lines (the only format)')
    .addHelpText('after', examples(['aip events --json'], style))
    .action(async () => {
      const ctx = context(io, style);
      await daemon(ctx);
      let interrupted = false;
      io.onSignal('SIGINT', () => {
        interrupted = true;
        io.exit(0);
      });
      await subscribe(ctx.socket, (line) => print(line));
      if (!interrupted) failLine(io, 'aip events', 'the daemon closed the stream');
    });
}
