import { rejected } from '../../../platform/errors/index.ts';
import type { PsRow } from '../../../platform/process/index.ts';
import { findGroup, runTitle, type AgentRoot, type RunState } from '../../runs/types/index.ts';
import type { ProcessesPublishPort } from '../ports/index.ts';
import type { BackgroundProcessesView } from '../types/index.ts';

import { selectBackground, terminateTree } from './tree.ts';

export interface ProcessDependencies {
  /** Agents that run now: running attempts and the naming of runs. */
  roots: () => AgentRoot[];
  lookup: (runId: string) => RunState | undefined;
  stopping: () => boolean;
  /** Takes the process table. */
  takeProcesses: () => Promise<PsRow[]>;
  /** How often subscribers get the background processes. */
  intervalMs: number;
  /** How long a snapshot of the process table answers requests. */
  cacheMs: number;
  /** Pause between a SIGTERM and the extra look at background processes. */
  killLookMs: number;
  /** Time between SIGTERM and SIGKILL when a background process is killed. */
  killGraceMs: number;
  publish: ProcessesPublishPort;
}

/** Processes the agents left running: watched while someone listens, killed on request. */
export class ProcessService {
  private readonly dependencies: ProcessDependencies;
  /** Agents that exited, by PID; their process group is background while it has members. */
  private readonly departed = new Map<number, AgentRoot>();
  private cache: { at: number; rows: PsRow[] } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private looking = false;
  /** The list (JSON) subscribers last got, or null. */
  private sent: string | null = null;
  private sentError: string | null = null;

  constructor(dependencies: ProcessDependencies) {
    this.dependencies = dependencies;
  }

  /** The list subscribers last got; a new subscriber gets it at once. */
  lastSent(): unknown[] | null {
    return this.sent === null ? null : (JSON.parse(this.sent) as unknown[]);
  }

  /** Starts looking at the processes regularly while someone listens. */
  watch(): void {
    if (this.timer || this.dependencies.stopping()) return;
    this.timer = setInterval(() => void this.look(), this.dependencies.intervalMs);
    this.timer.unref();
    void this.look();
  }

  /** Stops looking: the last subscriber left. */
  unwatch(): void {
    this.stop();
    this.sent = null;
    this.sentError = null;
  }

  /** Stops the timer; called when the daemon stops. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** An agent exited; what it left in its process group is still shown as background. */
  agentGone(root: AgentRoot): void {
    this.departed.set(root.pid, root);
  }

  async list(fresh = false): Promise<BackgroundProcessesView> {
    const { found } = await this.background(fresh);
    return {
      processes: found.map(({ root, ...process }) => {
        const state = this.dependencies.lookup(root.run) ?? null;
        const group = state && root.group !== null ? findGroup(state, root.group) : null;
        const attempt = group?.attempts.find((candidate) => candidate.seq === root.seq);
        return {
          ...process,
          owner: {
            runId: root.run,
            runTitle: state ? runTitle(state) : root.run,
            repository: state?.run.repository ?? '',
            group: root.group,
            groupTitle: group?.title ?? null,
            step: attempt?.stepId ?? null,
          },
        };
      }),
    };
  }

  async kill(pid: number): Promise<{ ok: true }> {
    const { rows, found } = await this.background(true);
    if (!found.some((process) => process.pid === pid)) {
      throw rejected(`not a background process: ${pid}`);
    }
    const look = (): void => void this.look(true);
    setTimeout(look, this.dependencies.killLookMs).unref();
    void terminateTree(pid, {
      rows,
      stillBackground: async () =>
        new Set((await this.background(true)).found.map((process) => process.pid)),
      graceMs: this.dependencies.killGraceMs,
    })
      .catch(() => undefined)
      .then(look);
    return { ok: true };
  }

  /** One look at background processes; tells subscribers when the list or the error changed. */
  private async look(fresh = false): Promise<void> {
    const { publish, stopping, roots } = this.dependencies;
    if (this.looking || stopping() || !publish.hasSubscribers()) return;
    if (!fresh && roots().length === 0 && this.departed.size === 0 && this.sent === '[]') return;
    this.looking = true;
    try {
      const { processes } = await this.list(fresh);
      const json = JSON.stringify(processes);
      this.sentError = null;
      if (json === this.sent || !publish.hasSubscribers()) return;
      this.sent = json;
      publish.processesChanged({ processes });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === this.sentError || !publish.hasSubscribers()) return;
      this.sentError = message;
      this.sent = null;
      publish.processesChanged({ error: message });
    } finally {
      this.looking = false;
    }
  }

  private async rows(fresh: boolean): Promise<PsRow[]> {
    const now = Date.now();
    if (!fresh && this.cache && now - this.cache.at < this.dependencies.cacheMs) {
      return this.cache.rows;
    }
    const rows = await this.dependencies.takeProcesses();
    this.cache = { at: now, rows };
    return rows;
  }

  private async background(fresh: boolean) {
    const rows = await this.rows(fresh);
    for (const pid of [...this.departed.keys()]) {
      if (!rows.some((row) => row.pgid === pid)) this.departed.delete(pid);
    }
    const roots = [...this.dependencies.roots(), ...this.departed.values()];
    return { rows, found: selectBackground(rows, roots) };
  }
}
