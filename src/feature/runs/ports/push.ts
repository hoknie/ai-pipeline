import type { RemoteBranch, Run } from '../types/index.ts';

/** How the sending of the branch of a delivery ended. */
export type PushOutcome = { ok: true; remoteBranch: RemoteBranch } | { ok: false; reason: string };

/** The delivery sends the branch `aip/<run>` to the remote repository of the project. */
export interface RunPushPort {
  push(run: Run): Promise<PushOutcome>;
}
