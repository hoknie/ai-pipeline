import type { McpEndpoint, McpReply } from '../types/index.ts';

/** The HTTP side of a registry: one JSON-RPC message in, its answer out; failures are `RegistryFailure`. */
export interface RegistryTransportPort {
  post(endpoint: McpEndpoint, message: Record<string, unknown>): Promise<McpReply>;
  /** Closes the session of the registry; never fails. */
  close(endpoint: McpEndpoint): Promise<void>;
}
