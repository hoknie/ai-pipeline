import type { EditorSpecialist } from '../../api/types.ts';

/** The human name of a specialist: the validated one, the one of the file, else the slug. */
export function specialistName(entry: EditorSpecialist): string {
  const effective = entry.effective?.name?.trim();
  if (effective) return effective;
  const raw = typeof entry.raw.name === 'string' ? entry.raw.name.trim() : '';
  return raw || entry.slug;
}

/** Slug → name of every specialist of the editor. */
export function specialistNames(entries: readonly EditorSpecialist[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.slug, specialistName(entry)]));
}

/** The name of a specialist, the slug when it is unknown. */
export function nameOf(names: ReadonlyMap<string, string>, slug: string): string {
  return names.get(slug) || slug;
}

/** «Name (slug)» for a choice; the bare slug when there is no other name. */
export function specialistOption(names: ReadonlyMap<string, string>, slug: string): string {
  const name = nameOf(names, slug);
  return name === slug ? slug : `${name} (${slug})`;
}
