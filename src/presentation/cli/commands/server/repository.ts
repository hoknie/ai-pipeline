import { isAbsolute } from 'node:path';

import { rejected } from '../../../../platform/errors/index.ts';
import { runGit } from '../../../../platform/git/index.ts';
import { request } from '../../../ipc/client/index.ts';
import type { Context } from '../../context.ts';

/** The `origin` and the other remotes of the repository in `directory`; none when it is no clone. */
async function remotesOf(directory: string): Promise<string[]> {
  const listed = await runGit(directory, ['remote', '-v'], { allowFailure: true });
  if (listed.code !== 0) return [];
  const urls = listed.stdout
    .split('\n')
    .map((line) => line.split(/\s+/)[1])
    .filter((url): url is string => url !== undefined && url !== '');
  return [...new Set(urls)];
}

/**
 * A path on this machine means nothing to a server: the project is found by the `git remote` of
 * that directory (`repository_match`) and named by its slug. A project slug passes as it is.
 */
export async function mapRepository<P>(ctx: Context, params: P): Promise<P> {
  const given = (params as { repository?: unknown }).repository;
  if (ctx.remote === null || typeof given !== 'string' || !isAbsolute(given)) return params;
  const remotes = await remotesOf(given);
  if (remotes.length === 0) {
    throw rejected(
      `${given} has no git remote the server could match: name the project with --repo <slug>`,
    );
  }
  const found = (await request(ctx.remote, 'repository_match', { remotes })) as {
    project: { slug: string | null; path: string } | null;
  };
  if (found.project === null) {
    throw rejected(
      `the server has no project for the remotes of ${given}: add it there or name one with --repo <slug>`,
    );
  }
  return { ...params, repository: found.project.slug ?? found.project.path };
}
