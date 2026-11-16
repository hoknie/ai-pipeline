import type { Rule, Violation } from './check.ts';

export interface ExceptionEntry {
  rule: Rule;
  /** Path from the repository root: `src/...` or `web/src/...`. */
  path: string;
  /** Function or class, if the entry is about one; for `purity`, the external dependency (`node:fs`, `yaml`). */
  name?: string;
  /** Size at the time of the entry: lines of code, methods, files in the folder, 1 for `purity` (one entry per dependency), count of `process.env`. */
  size: number;
}

/** Rules whose violations may be listed; the rest are never forgiven. */
export const excusableRules: readonly Rule[] = [
  'file-size',
  'function-size',
  'folder-size',
  'class-size',
  'purity',
  'environment',
];

const keyOf = (entry: { rule: Rule; path: string; name?: string | undefined }): string =>
  `${entry.rule}|${entry.path}|${entry.name ?? ''}`;

/**
 * Reconciles violations with the exception list. Returns messages: a violation without an entry,
 * a size above the recorded one, an entry that is no longer needed, a duplicate entry.
 */
export function reconcile(
  violations: Violation[],
  exceptions: readonly ExceptionEntry[],
): string[] {
  const problems: string[] = [];
  const recorded = new Map<string, ExceptionEntry>();
  for (const entry of exceptions) {
    const key = keyOf(entry);
    if (recorded.has(key)) problems.push(`${entry.path}: duplicate exception \`${entry.rule}\``);
    recorded.set(key, entry);
  }
  const used = new Set<string>();
  for (const found of violations) {
    if (!excusableRules.includes(found.rule)) {
      problems.push(found.message);
      continue;
    }
    const key = keyOf(found);
    const entry = recorded.get(key);
    if (!entry) {
      problems.push(`${found.message} [not in the exception list]`);
      continue;
    }
    used.add(key);
    if (found.size > entry.size) {
      problems.push(`${found.message} [grew: the exception list records ${entry.size}]`);
    }
  }
  for (const [key, entry] of recorded) {
    if (used.has(key)) continue;
    const what = entry.name === undefined ? entry.rule : `${entry.rule} \`${entry.name}\``;
    problems.push(`${entry.path}: exception ${what} is no longer needed, remove it from the list`);
  }
  return problems;
}
