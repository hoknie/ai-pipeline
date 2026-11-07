import { randomUUID } from 'node:crypto';

import type { SupervisedProcess } from '../../../agents/services/index.ts';
import type { AgentRoot } from '../../types/index.ts';

import { keyOf, type AttemptKey } from './context.ts';

interface Running {
  process: SupervisedProcess;
  timer: NodeJS.Timeout;
  key: AttemptKey;
}

/** The agents that run now: attempts by their key, the naming of runs, the report tokens. */
export class RunningAgents {
  private readonly running = new Map<string, Running>();
  private readonly naming = new Map<SupervisedProcess, string>();
  private readonly tokens = new Map<string, AttemptKey>();

  add(key: AttemptKey, process: SupervisedProcess, timer: NodeJS.Timeout): void {
    this.running.set(keyOf(key), { process, timer, key });
  }

  remove(key: AttemptKey): void {
    this.running.delete(keyOf(key));
  }

  /** The process of an attempt, while it runs. */
  process(key: AttemptKey): SupervisedProcess | undefined {
    return this.running.get(keyOf(key))?.process;
  }

  /** Stops the agent of an attempt; its exit comes as usual. */
  stop(key: AttemptKey): void {
    const running = this.running.get(keyOf(key));
    if (!running) return;
    clearTimeout(running.timer);
    running.process.stop();
  }

  addNaming(process: SupervisedProcess, run: string): void {
    this.naming.set(process, run);
  }

  removeNaming(process: SupervisedProcess): void {
    this.naming.delete(process);
  }

  /** A new token the worker MCP server of the attempt reports with. */
  issueToken(key: AttemptKey): string {
    const token = randomUUID();
    this.tokens.set(token, key);
    return token;
  }

  dropToken(token: string): void {
    this.tokens.delete(token);
  }

  attemptFor(token: string): AttemptKey | undefined {
    return this.tokens.get(token);
  }

  /** Agents that run now: running attempts and the naming of runs. */
  roots(): AgentRoot[] {
    const roots: AgentRoot[] = [];
    for (const { process, key } of this.running.values()) {
      if (process.pid !== undefined) {
        roots.push({ pid: process.pid, run: key.run, group: key.group, seq: key.seq });
      }
    }
    for (const [process, run] of this.naming) {
      if (process.pid !== undefined) roots.push({ pid: process.pid, run, group: null, seq: null });
    }
    return roots;
  }

  /** A specialist or the naming of a run is running. */
  busy(): boolean {
    return this.running.size > 0 || this.naming.size > 0;
  }

  /** Stops every agent; resolves when all of them exited. */
  async stopAll(): Promise<void> {
    const exits = [...this.running.values()].map((running) => {
      clearTimeout(running.timer);
      running.process.stop();
      return running.process.exited;
    });
    for (const process of this.naming.keys()) {
      process.stop();
      exits.push(process.exited);
    }
    await Promise.allSettled(exits);
  }
}
