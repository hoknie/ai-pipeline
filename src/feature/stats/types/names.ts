import type { AttemptRecord } from './records.ts';

/**
 * Names of the rows of a breakdown. For every key the projects of its attempts are tried from the
 * one with the most attempts (ties: the smaller path first); the first name that is not empty and
 * differs from the key wins.
 */
export function breakdownNames(
  attempts: AttemptRecord[],
  keyOf: (record: AttemptRecord) => string,
  nameIn: (repository: string, key: string) => string | null | undefined,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const record of attempts) {
    const key = keyOf(record);
    const own = counts.get(key) ?? new Map<string, number>();
    own.set(record.repository, (own.get(record.repository) ?? 0) + 1);
    counts.set(key, own);
  }
  const names = new Map<string, string>();
  for (const [key, own] of counts) {
    const repositories = [...own].sort(
      ([leftPath, left], [rightPath, right]) =>
        right - left || (leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0),
    );
    for (const [repository] of repositories) {
      const name = nameIn(repository, key);
      if (name !== undefined && name !== null && name !== '' && name !== key) {
        names.set(key, name);
        break;
      }
    }
  }
  return names;
}
