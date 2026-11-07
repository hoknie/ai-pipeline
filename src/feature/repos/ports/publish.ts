/** Tells the clients of the daemon that the registry of repositories changed. */
export interface ReposPublishPort {
  repositoriesChanged(): void;
}
