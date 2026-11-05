/** Longest name of a specialist tag, in characters. */
export const TAG_NAME_MAX = 30;

/** Why the name cannot be a specialist tag, or null. Surrounding spaces are not part of the name. */
export function tagNameProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  const name = value.trim();
  if (name === '') return 'must not be empty';
  if (name.includes('\n') || name.includes('\r')) return 'must not contain a line break';
  if ([...name].length > TAG_NAME_MAX) return `must be at most ${TAG_NAME_MAX} characters`;
  return null;
}

/** Trimmed names without repeats (case-insensitive, also for Cyrillic); the first spelling stays. */
export function uniqueTags(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** Whether two tag names are the same tag. */
export function sameTag(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/** The tags a parsed file has; empty when `tags` is missing or not valid. */
export function tagsOf(raw: unknown): string[] {
  const list =
    typeof raw === 'object' && raw !== null ? (raw as { tags?: unknown }).tags : undefined;
  if (!Array.isArray(list)) return [];
  if (list.some((item) => tagNameProblem(item) !== null)) return [];
  return uniqueTags(list as string[]);
}
