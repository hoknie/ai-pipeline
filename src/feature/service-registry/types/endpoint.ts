/** Where and how one request to a registry goes. */
export interface McpEndpoint {
  /** The root of the registry, no trailing slash. */
  base: string;
  token: string;
  /** The `Mcp-Session-Id` of the session, once the registry issued one. */
  sessionId?: string | null;
  /** The proxy for this request; null: direct. Read before every request. */
  proxyFor: (url: string) => string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface McpReply {
  /** The JSON-RPC answer; null for a notification the registry accepted. */
  message: Record<string, unknown> | null;
  sessionId: string | null;
}
