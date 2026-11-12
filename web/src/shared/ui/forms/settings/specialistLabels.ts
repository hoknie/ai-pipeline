import type { EditorSpecialist } from '../../../api/types.ts';

/** A specialist choice of a form: the slug is the value written to the file, the label is shown. */
export interface SpecialistOption {
  slug: string;
  label: string;
}

/** The name of a specialist: the effective one, else the one in its file; null when there is none. */
function nameOf(specialist: EditorSpecialist): string | null {
  for (const name of [specialist.effective?.name, specialist.raw.name]) {
    if (typeof name === 'string' && name.trim() !== '') return name.trim();
  }
  return null;
}

/**
 * The choices of a specialist reference. The label is the name; it falls back to the slug when
 * there is no name, and gets the slug in brackets when another specialist has the same label.
 */
export function specialistOptions(specialists: readonly EditorSpecialist[]): SpecialistOption[] {
  const bases = specialists.map((specialist) => nameOf(specialist) ?? specialist.slug);
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  return specialists.map((specialist, index) => {
    const base = bases[index] ?? specialist.slug;
    const named = nameOf(specialist) !== null;
    const ambiguous = named && (counts.get(base) ?? 0) > 1;
    return { slug: specialist.slug, label: ambiguous ? `${base} (${specialist.slug})` : base };
  });
}
