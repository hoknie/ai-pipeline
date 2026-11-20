/** A version of a registry skill chosen for a run. */
export interface RegistrySkillPin {
  name: string;
  version: string;
  /** The id of the connection of the registry the version came through. */
  connection: string;
}

export interface RegistrySkillsPinned {
  pinned: RegistrySkillPin[];
  /** One warning per reference that could not be served: `skill not found: <ref> (<reason>)`. */
  problems: string[];
}

/**
 * The skills of a service registry for the specialists of a run. Set against the arrows of the
 * graph by the composition root: the runs know the references and the versions, not the registry.
 */
export interface RegistrySkillsPort {
  /**
   * Chooses and downloads a version for each `registry:` reference of the project. Nothing is
   * chosen for a reference that cannot be served, so the next attempt tries again.
   */
  pin(project: string, references: readonly string[]): Promise<RegistrySkillsPinned>;
  /** Lays the versions out under `<directory>/.claude/skills`; returns the warnings. */
  materialize(
    project: string,
    pinned: readonly RegistrySkillPin[],
    directory: string,
  ): Promise<string[]>;
}
