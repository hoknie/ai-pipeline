import type { ConnectionChange } from '../types/index.ts';

export type { ConnectionChange };

/**
 * The changes of connections that others live by: a channel starts and stops its listener, moves
 * to new parameters or forgets what it kept. Set against the arrows of the graph by the
 * composition root; a failing listener of the other side never fails the change itself.
 */
export interface IntegrationChangesPort {
  connectionChanged(id: string, change: ConnectionChange): void;
}
