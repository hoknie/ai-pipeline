/** Tells the clients of the daemon that the tag catalog of a repository changed. */
export interface TagsPublishPort {
  tagsChanged(repository: string): void;
}
