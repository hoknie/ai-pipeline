import type { Event, OnLimit, RunState } from '../core/index.ts';

import type { AgentRoot } from './processes.ts';

/** What the executor takes from the daemon that owns it: the port the daemon implements. */
export interface ExecutorHost {
  /** Path of the daemon socket the worker MCP servers connect to. */
  readonly socket: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly stopping: boolean;
  apply(state: RunState, event: Event): Promise<void>;
  /** Runs `work` after everything queued before it. */
  serial<T>(work: () => Promise<T>): Promise<T>;
  /** An agent process exited: its process group is background while it has members. */
  agentGone(root: AgentRoot): void;
  savePatch(state: RunState): Promise<void>;
  refreshDiff(state: RunState, slug: string): Promise<void>;
  save(state: RunState): void;
  onLimitOf(repository: string): OnLimit;
}
