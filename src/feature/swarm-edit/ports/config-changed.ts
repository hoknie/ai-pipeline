/** Tells the clients of the daemon that the configuration of a repository changed. */
export interface ConfigChangedPort {
  configChanged(repository: string): void;
}
