/** A project of a service registry as an attempt is told about it. */
export interface RegistryProjectAnswer {
  /** The path of the project in the registry. */
  path: string;
  /** The name of the MCP server of the specialist that goes to the registry. */
  server: string;
}

/**
 * The project of the service registry the project of a run is linked to. Set against the arrows
 * of the graph by the composition root: the runs know the names of the connections of the servers
 * of a specialist, not what stands behind them.
 */
export interface RegistryProjectPort {
  /**
   * The link of `project` through the first of `servers` that has one (matching it by `origin`
   * when it has none and the rules allow); null when there is no link. May wait for a registry:
   * the caller bounds the wait. Never throws.
   */
  projectFor(
    project: string,
    servers: readonly { server: string; connection: string }[],
  ): Promise<RegistryProjectAnswer | null>;
}
