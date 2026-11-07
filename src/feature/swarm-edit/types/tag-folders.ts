import { type FieldError } from '../../swarm-config/types/index.ts';

/** One specialist file of a level, as the tag editor sees it. */
export interface SpecialistTagEntry {
  slug: string;
  name: string | null;
  tags: string[];
  /** Revision of the file; null when the file could not be read. */
  revision: string | null;
  /** Why the file cannot be read; the specialist stays in the list. */
  error?: string;
}

/** The specialists of one level (shared or one project) with their tags. */
export interface SpecialistTagFolder {
  /** Directory with the specialist files of the level. */
  directory: string;
  specialists: SpecialistTagEntry[];
}

/** A file to write: its new text, or the text to restore. */
export interface TagFileEdit {
  file: string;
  text: string;
  revision: string | null;
}

export type TagPlan =
  | { ok: true; edits: TagFileEdit[] }
  | { ok: false; reason: 'invalid'; errors: FieldError[] }
  | { ok: false; reason: 'conflict'; message: string; slugs?: string[] };
