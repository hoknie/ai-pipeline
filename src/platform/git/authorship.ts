import { runGit } from './runner.ts';

/** Who a delivery commit is by: the author of the run; `null` keeps the git identity of the daemon. */
export interface DeliveryIdentity {
  author: { name: string; email: string } | null;
}

/** `GIT_AUTHOR_*` of a commit by the author of a run; the committer stays the git identity of the OS user. */
export function authorEnvironment(identity: DeliveryIdentity | undefined): NodeJS.ProcessEnv {
  const author = identity?.author;
  return author ? { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email } : {};
}

/** A commit with the tree of `ref` on top of `parent`, written by the author of the run; returns its id. */
export async function commitTreeAs(
  repository: string,
  ref: string,
  parent: string,
  message: string,
  identity: DeliveryIdentity,
): Promise<string> {
  const made = await runGit(
    repository,
    ['commit-tree', `${ref}^{tree}`, '-p', parent, '-m', message],
    { env: authorEnvironment(identity) },
  );
  return made.stdout.trim();
}
