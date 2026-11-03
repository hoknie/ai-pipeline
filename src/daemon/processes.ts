import { execFile } from 'node:child_process';

import type { BackgroundProcessView } from '../protocol/index.ts';

/** Pause between SIGTERM and SIGKILL of a terminated process tree. */
export const KILL_GRACE_MS = 5_000;
const PS_TIMEOUT_MS = 5_000;

export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** Seconds since the process started. */
  elapsed: number;
  /** CPU seconds the process has used. */
  cpuSeconds: number;
  /** Resident memory in kilobytes. */
  rssKb: number;
  args: string;
}

/** An agent (or a process that was one) whose descendants and process group are background. */
export interface AgentRoot {
  pid: number;
  run: string;
  group: string | null;
  seq: number | null;
}

export interface BackgroundProcess extends Omit<BackgroundProcessView, 'owner'> {
  root: AgentRoot;
}

/** `[[dd-]hh:]mm:ss[.ff]` (`etime` and `time` of `ps` on macOS and Linux) in seconds. */
export function parseClock(text: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds)
  );
}

const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s*(.*)$/;

/** Parses the output of `ps -o pid=,ppid=,pgid=,etime=,time=,rss=,args=`; other lines are skipped. */
export function parsePs(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split('\n')) {
    const match = ROW.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      elapsed: parseClock(match[4]!),
      cpuSeconds: parseClock(match[5]!),
      rssKb: Number(match[6]),
      args: match[7]!.trim(),
    });
  }
  return rows;
}

/** The MCP server of a specialist: killing it breaks the report of the specialist. */
function isWorkerServer(args: string): boolean {
  return /(^|\s)mcp(\s|$)/.test(args) && /(^|\s)--worker(\s|=|$)/.test(args);
}

/** Executable name without the directory, from the first word of the command line. */
function nameOf(args: string): string {
  const first = args.split(/\s+/)[0] ?? '';
  const name = first.slice(first.lastIndexOf('/') + 1);
  return name === '' ? args : name;
}

/** Descendants (by parent) and members of the process groups of the roots, longest-running first. */
export function selectBackground(
  rows: readonly PsRow[],
  roots: readonly AgentRoot[],
): BackgroundProcess[] {
  const children = new Map<number, PsRow[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row);
    children.set(row.ppid, list);
  }
  const rootPids = new Set(roots.map((root) => root.pid));
  const owner = new Map<number, AgentRoot>();
  for (const root of roots) {
    const pending = [...(children.get(root.pid) ?? [])];
    while (pending.length > 0) {
      const row = pending.pop()!;
      if (owner.has(row.pid) || rootPids.has(row.pid)) continue;
      owner.set(row.pid, root);
      pending.push(...(children.get(row.pid) ?? []));
    }
  }
  const byPid = new Map(roots.map((root) => [root.pid, root]));
  for (const row of rows) {
    const root = byPid.get(row.pgid);
    if (root && !owner.has(row.pid) && !rootPids.has(row.pid)) owner.set(row.pid, root);
  }
  const found: (BackgroundProcess & { elapsed: number })[] = [];
  for (const row of rows) {
    const root = owner.get(row.pid);
    if (!root || isWorkerServer(row.args)) continue;
    found.push({
      pid: row.pid,
      name: nameOf(row.args),
      command: row.args,
      uptimeSeconds: row.elapsed,
      cpuPercent: row.elapsed > 0 ? (row.cpuSeconds / row.elapsed) * 100 : 0,
      memoryBytes: row.rssKb * 1024,
      root,
      elapsed: row.elapsed,
    });
  }
  found.sort((a, b) => b.elapsed - a.elapsed || a.pid - b.pid);
  return found.map(({ elapsed: _elapsed, ...process }) => process);
}

export type PsRunner = (
  file: string,
  args: string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string) => void,
) => unknown;

/** Runs `ps` over all processes; the runner is replaceable for tests. */
export function snapshotProcesses(run: PsRunner = execFile as PsRunner): Promise<PsRow[]> {
  return new Promise((resolve, reject) => {
    run(
      'ps',
      ['-A', '-o', 'pid=,ppid=,pgid=,etime=,time=,rss=,args='],
      { timeout: PS_TIMEOUT_MS },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(parsePs(String(stdout)));
      },
    );
  });
}

export interface TerminateOptions {
  /** Snapshot taken before the call. */
  rows: readonly PsRow[];
  /** PIDs that are still background processes after the grace period. */
  stillBackground: () => Promise<ReadonlySet<number>>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  wait?: (ms: number) => Promise<void>;
  graceMs?: number;
}

function send(
  kill: (pid: number, signal: NodeJS.Signals) => void,
  pid: number,
  signal: NodeJS.Signals,
) {
  try {
    kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * SIGTERM to the process and its descendants, then, after the grace period, SIGKILL to those of
 * them that are still background processes (a PID may have been reused meanwhile).
 */
export async function terminateTree(pid: number, options: TerminateOptions): Promise<number[]> {
  const kill = options.kill ?? ((target, signal) => process.kill(target, signal));
  const wait =
    options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref()));
  const children = new Map<number, number[]>();
  for (const row of options.rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  const targets: number[] = [];
  const pending = [pid];
  while (pending.length > 0) {
    const next = pending.shift()!;
    if (targets.includes(next)) continue;
    targets.push(next);
    pending.push(...(children.get(next) ?? []));
  }
  for (const target of targets) send(kill, target, 'SIGTERM');
  await wait(options.graceMs ?? KILL_GRACE_MS);
  const alive = await options.stillBackground();
  for (const target of targets) if (alive.has(target)) send(kill, target, 'SIGKILL');
  return targets;
}
