import type { Run } from '../../runs/types/index.ts';
import type { ConfigService } from '../../swarm-config/services/index.ts';
import type { DeliveryAuthorsPort } from '../ports/index.ts';
import { withTrailer } from '../types/index.ts';

/** The message and the identity of a delivery commit (the shape of the runs port `RunCommitsPort`; the layout forbids importing it here). */
export interface CommitStamp {
  message: string;
  identity: { author: { name: string; email: string } | null };
}

/** The server mode: the commit of a delivery is by the author of the run and may carry a co-author. */
export class CommitStamper {
  private readonly dependencies: { config: ConfigService; authors: DeliveryAuthorsPort };

  constructor(dependencies: { config: ConfigService; authors: DeliveryAuthorsPort }) {
    this.dependencies = dependencies;
  }

  /** `null` in the local mode: the author, the committer and the message stay as they were. */
  stamp(run: Run, message: string): CommitStamp | null {
    const settings = this.dependencies.config.serverSettings();
    if (typeof settings === 'string' || !settings.enabled) return null;
    const author = run.author === null ? null : this.dependencies.authors.byId(run.author);
    return {
      message:
        settings.commitTrailer === null ? message : withTrailer(message, settings.commitTrailer),
      identity: { author },
    };
  }
}
