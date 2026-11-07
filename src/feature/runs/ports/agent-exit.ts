import type { AgentRoot } from '../types/index.ts';

/** An agent exited; what it left in its process group is still background. */
export interface AgentExitPort {
  agentGone(root: AgentRoot): void;
}
