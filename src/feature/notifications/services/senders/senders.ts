import type { IntegrationsServices } from '../../../integrations/services/index.ts';

import { RecentSenders, type Sender } from './recent.ts';

export interface SendersDependencies {
  integrations: IntegrationsServices;
  recent: RecentSenders;
  now: () => number;
}

/** The recent senders a panel offers for the list of users of a connection. */
export class NotificationSenders {
  private readonly dependencies: SendersDependencies;

  constructor(dependencies: SendersDependencies) {
    this.dependencies = dependencies;
  }

  /** The people who wrote lately and are not allowed yet; `not_found` for an unknown connection. */
  forConnection(id: string): Sender[] {
    const { integrations, recent, now } = this.dependencies;
    const connection = integrations.access.find(id);
    const kind = integrations.connections.types().find((one) => one.kind === connection.kind);
    const names = (kind?.params ?? []).filter((spec) => spec.userList === true);
    if (names.length === 0) return [];
    const allowed = new Set(
      names.flatMap((spec) =>
        (connection.params[spec.name] ?? '')
          .split(',')
          .map((one) => one.trim())
          .filter((one) => one !== ''),
      ),
    );
    return recent.list(id, now()).filter((one) => !allowed.has(one.user));
  }
}
