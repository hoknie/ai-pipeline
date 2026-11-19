import { git } from './runner.ts';

/**
 * The paths of `git diff --name-status -M -z`: a rename or a copy names two paths (the old one
 * and the new one), every other change names one. Sorted, without repeats.
 */
export function nameStatusFiles(output: string): string[] {
  const parts = output.split('\0').filter((part) => part !== '');
  const files: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const status = parts[index] ?? '';
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push(parts[index + 1] ?? '', parts[index + 2] ?? '');
      index += 2;
    } else {
      files.push(parts[index + 1] ?? '');
      index += 1;
    }
  }
  return [...new Set(files.filter((file) => file !== ''))].sort();
}

/** The files that differ between two commits; a renamed file counts under both paths. */
export async function changedFiles(
  repository: string,
  from: string,
  to: string,
): Promise<string[]> {
  return nameStatusFiles(await git(repository, 'diff', '--name-status', '-M', '-z', from, to));
}
