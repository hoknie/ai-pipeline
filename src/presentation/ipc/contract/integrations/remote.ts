import { z } from 'zod';

/** The answer of `mcp_remote_forward`: the JSON-RPC answer for the agent; null for a notification. */
export interface RemoteForwarded {
  message: Record<string, unknown> | null;
}

/**
 * One JSON-RPC message of the bridge of an attempt to a server that goes through a connection.
 * Only the token of a running attempt may call it: no user, no panel and no remote client.
 */
export const mcpRemoteRequests = [
  z.object({
    method: z.literal('mcp_remote_forward'),
    params: z.object({
      token: z.string().min(1).max(256),
      server: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      message: z.record(z.string(), z.unknown()),
    }),
  }),
] as const;
