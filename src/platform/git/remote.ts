import { git, gitFailure, runGit } from './runner.ts';

/** The branch of a remote repository and the commit at its tip. */
export interface RemoteBase {
  branch: string;
  commit: string;
}

/** How a push ended: sent, or refused with the reason git gave. */
export type PushResult = { ok: true } | { ok: false; reason: string };

/** The URL of the remote of `repository`. */
export async function remoteUrl(repository: string, remote: string): Promise<string> {
  return git(repository, 'remote', 'get-url', remote);
}

/** The remote of `repository` that has this address (compared after normalizing), or `null`. */
export async function findRemote(
  repository: string,
  matches: (url: string) => boolean,
): Promise<string | null> {
  const names = (await git(repository, 'remote')).split('\n').filter((name) => name !== '');
  for (const name of names) {
    const urls = (await runGit(repository, ['remote', 'get-url', '--all', name])).stdout
      .split('\n')
      .filter((url) => url !== '');
    if (urls.some(matches)) return name;
  }
  return null;
}

/**
 * Fetches `refs/heads/<branch>` of `remote` into `refs/remotes/<remote>/<branch>` and returns the
 * commit at its tip. A git failure (no access, no such branch) is thrown with git's own text.
 */
export async function fetchBranch(
  repository: string,
  remote: string,
  branch: string,
): Promise<string> {
  const target = `refs/remotes/${remote}/${branch}`;
  await runGit(repository, ['fetch', '--no-tags', remote, `+refs/heads/${branch}:${target}`]);
  return git(repository, 'rev-parse', '--verify', `${target}^{commit}`);
}

/** The branch the `HEAD` of `remote` points to (its main branch). */
export async function remoteHead(repository: string, remote: string): Promise<string> {
  const output = (await runGit(repository, ['ls-remote', '--symref', remote, 'HEAD'])).stdout;
  const match = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output);
  if (!match?.[1])
    throw gitFailure(`the remote \`${remote}\` does not say which branch its HEAD is`);
  return match[1];
}

/**
 * The commit a run starts from in the server mode: the tip of `baseBranch` of `remote` (its `HEAD`
 * branch when null), fetched just now.
 */
export async function resolveBase(
  repository: string,
  remote: string,
  baseBranch: string | null,
): Promise<RemoteBase> {
  const branch = baseBranch ?? (await remoteHead(repository, remote));
  return { branch, commit: await fetchBranch(repository, remote, branch) };
}

/** The reason of a refused push: the `[rejected]` line of `--porcelain`, else what git said. */
function pushReason(stdout: string, stderr: string): string {
  const line = stdout.split('\n').find((text) => text.startsWith('!'));
  const refused = line?.split('\t').slice(2).join(' ').trim();
  const said = stderr
    .split('\n')
    .map((text) => text.replace(/^(error|fatal): /, '').trim())
    .filter((text) => text !== '' && !text.startsWith('hint:'));
  const detail = said.length > 0 ? said.join('; ') : null;
  if (refused) return detail ? `${refused}: ${detail}` : refused;
  return detail ?? 'git push failed';
}

/**
 * Sends the local branch `refs/heads/<branch>` to the branch of the same name of `remote`. Never
 * forces: a branch with another history is refused and stays as it is.
 */
export async function pushBranch(
  repository: string,
  remote: string,
  branch: string,
): Promise<PushResult> {
  const spec = `refs/heads/${branch}:refs/heads/${branch}`;
  const result = await runGit(repository, ['push', '--porcelain', remote, spec], {
    allowFailure: true,
  });
  if (result.code === 0) return { ok: true };
  return { ok: false, reason: pushReason(result.stdout, result.stderr) };
}
