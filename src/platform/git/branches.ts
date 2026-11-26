import { runGit } from './runner.ts';

/** A bounded, sorted search of local branch names, never remote or internal refs. */
export async function searchLocalBranches(
  repository: string,
  query: string,
  exact = false,
): Promise<string[]> {
  const { stdout } = await runGit(repository, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname:strip=2)',
    'refs/heads/',
  ]);
  return stdout
    .split('\n')
    .filter((name) => name !== '' && (exact ? name === query : name.includes(query)))
    .slice(0, 50);
}
