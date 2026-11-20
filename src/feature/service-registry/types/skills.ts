/** One skill of a registry as `list_skills` describes it. */
export interface RegistrySkill {
  id: string;
  name: string;
  title: string;
  description: string;
  tags: string[];
  /** The versions the registry offers, as it listed them. */
  versions: string[];
}

/** A version fixed for a run: where it came from and which one it is. */
export interface PinnedRegistrySkill {
  name: string;
  version: string;
  /** The id of the connection the version was taken through. */
  connection: string;
}

/** The longest archive of a skill the daemon downloads. */
export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
/** The longest a download of one skill lasts. */
export const SKILL_TIMEOUT_MS = 60_000;
/** The most pages of `list_skills` read to find one name. */
export const MAX_LIST_PAGES = 5;
export const LIST_PAGE_SIZE = 50;
/** A cached version that nobody used for so long is removed. */
export const CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The reason a skill cannot be used; it ends up in the warning of the step. */
export type SkillReason = string;

/**
 * The name in the front matter of a `SKILL.md`: the `name:` line between the first two `---`
 * lines; null when there is none.
 */
export function skillNameOf(text: string): string | null {
  const lines = text.replace(/^﻿/u, '').split(/\r?\n/u);
  if (lines[0]?.trim() !== '---') return null;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') return null;
    const match = /^name\s*:\s*(.*?)\s*$/u.exec(line);
    if (match !== null) return (match[1] ?? '').replace(/^(["'])(.*)\1$/u, '$2');
  }
  return null;
}
