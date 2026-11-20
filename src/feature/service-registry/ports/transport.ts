import type { McpEndpoint, McpReply } from '../types/index.ts';

/** The HTTP side of a registry: one JSON-RPC message in, its answer out; failures are `RegistryFailure`. */
export interface RegistryTransportPort {
  post(endpoint: McpEndpoint, message: Record<string, unknown>): Promise<McpReply>;
  /** Closes the session of the registry; never fails. */
  close(endpoint: McpEndpoint): Promise<void>;
  /**
   * The body of `GET <base><path>` with the bearer token, at most `maxBytes` long; failures are
   * `RegistryFailure`.
   */
  download(endpoint: McpEndpoint, path: string, maxBytes: number): Promise<Buffer>;
}
