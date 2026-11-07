import { execFile } from 'node:child_process';

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
