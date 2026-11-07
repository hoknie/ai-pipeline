import type { EditorSpecialist } from '../../shared/api/types.ts';

/** Whether two tag names are the same tag: case does not matter. */
export const sameTag = (left: string, right: string): boolean =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

/** The tags of a specialist in display order: shared first, then its own; a repeat shows once. */
export function tagsOfSpecialist(
  entry: Pick<EditorSpecialist, 'shared_tags' | 'own_tags'>,
): { name: string; shared: boolean }[] {
  const result: { name: string; shared: boolean }[] = [];
  for (const [names, shared] of [
    [entry.shared_tags, true],
    [entry.own_tags, false],
  ] as const) {
    for (const name of names) {
      if (!result.some((known) => sameTag(known.name, name))) result.push({ name, shared });
    }
  }
  return result;
}

/** Tags of the specialists of a repository for the filter, shared and own, sorted by name. */
export function repositoryTags(
  entries: readonly Pick<EditorSpecialist, 'shared_tags' | 'own_tags'>[],
): { name: string; shared: boolean }[] {
  const result: { name: string; shared: boolean }[] = [];
  for (const entry of entries) {
    for (const tag of tagsOfSpecialist(entry)) {
      const known = result.find((candidate) => sameTag(candidate.name, tag.name));
      if (!known) result.push({ ...tag });
      else if (tag.shared) known.shared = true;
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

/** The specialists that have at least one of the selected tags; all of them when none is selected. */
export function filterSpecialists<T extends Pick<EditorSpecialist, 'shared_tags' | 'own_tags'>>(
  entries: readonly T[],
  selected: readonly string[],
): T[] {
  if (selected.length === 0) return [...entries];
  return entries.filter((entry) =>
    tagsOfSpecialist(entry).some((tag) => selected.some((name) => sameTag(name, tag.name))),
  );
}

/** The selected tags that still exist, spelled as the repository spells them. */
export function existingSelection(
  selected: readonly string[],
  available: readonly { name: string }[],
): string[] {
  return selected.flatMap((name) => {
    const found = available.find((tag) => sameTag(tag.name, name));
    return found ? [found.name] : [];
  });
}
