import { type EntryReference } from './editor.ts';

/** A repository of the registry that needs a shared pipeline, and why. */
export interface SharedPipelineProject {
  repository: string;
  references: EntryReference[];
}

/** One shared pipeline file with the places that need it. */
export interface SharedPipelineUsage {
  id: string;
  name: string | null;
  /** Shared tags of the file. */
  tags: string[];
  /** Path of the shared file. */
  file: string;
  /** Revision of the file; null when the file could not be read. */
  revision: string | null;
  /** Why the file cannot be read; there are no references then. */
  error?: string;
  /** References from the shared level (shared pipelines that delegate through `split.pipeline`). */
  global: EntryReference[];
  /** Repositories where the shared pipeline is used, in the order of `projects` of the call. */
  projects: SharedPipelineProject[];
}

export interface SharedPipelinesUsage {
  /** Directory with the shared pipeline files. */
  directory: string;
  pipelines: SharedPipelineUsage[];
}

/** A repository of the registry that needs a shared specialist, and why. */
export interface SharedSpecialistProject {
  repository: string;
  references: EntryReference[];
}

/** One shared specialist file with the places that need it. */
export interface SharedSpecialistUsage {
  slug: string;
  name: string | null;
  /** Path of the shared file. */
  file: string;
  /** Revision of the file; null when the file could not be read. */
  revision: string | null;
  /** Why the file cannot be read; there are no references then. */
  error?: string;
  /** References from the shared level (shared pipelines and shared `delivery.*`). */
  global: EntryReference[];
  /** Repositories where the shared specialist is used, in the order of `projects` of the call. */
  projects: SharedSpecialistProject[];
}

export interface SharedSpecialistsUsage {
  /** Directory with the shared specialist files. */
  directory: string;
  specialists: SharedSpecialistUsage[];
}
