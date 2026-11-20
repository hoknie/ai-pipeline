/** Why a server of an attempt that goes through a connection cannot start. */
export type RemoteMcpRefusal = 'unavailable' | 'disabled';

export type RemoteMcpResolution = { ok: true } | { ok: false; reason: RemoteMcpRefusal };

/**
 * The connections the MCP servers of a specialist go through. Set against the arrows of the graph
 * by the composition root: the runs know the name of a connection, not what stands behind it.
 */
export interface RemoteMcpPort {
  /**
   * Whether the connection of this name serves the project now: the project one first, then the
   * shared one; enabled and with its secrets. No secret is read.
   */
  resolve(project: string, connection: string): RemoteMcpResolution;
  /** The attempt with this token ended: whatever was kept open for it is closed. */
  attemptEnded(token: string): void;
}
