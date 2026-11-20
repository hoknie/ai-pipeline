import { pushBranch, remoteUrl } from '../../../platform/git/index.ts';
import { deliveryBranch, type RemoteBranch, type Run } from '../../runs/types/index.ts';
import { remoteAddress, remoteWebUrl } from '../types/index.ts';

/** The shape of the runs port `RunPushPort` (the layout forbids importing it here). */
export type PushOutcome = { ok: true; remoteBranch: RemoteBranch } | { ok: false; reason: string };

/** Sends the branch of a delivery to the remote repository, with the git credentials of the daemon. */
export class PushService {
  /** Never forces and touches no other branch; the reason of a refusal comes from git. */
  async push(run: Run): Promise<PushOutcome> {
    const { remote } = run.config.delivery;
    const branch = deliveryBranch(run);
    try {
      const result = await pushBranch(run.repository, remote, branch);
      if (!result.ok) return result;
      const address = await remoteUrl(run.repository, remote);
      const url = remoteWebUrl(address, branch);
      return { ok: true, remoteBranch: { remote, branch, url, address: remoteAddress(address) } };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }
}
