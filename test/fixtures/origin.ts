import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

/**
 * Gives `repo` a bare `origin` next to it and pushes its main branch there: in the server mode a
 * run starts from the main branch of the remote repository, so a project without one cannot run.
 * Returns the path of the bare repository.
 */
export function addOrigin(repo: string): string {
  const bare = join(dirname(repo), `${repo.split('/').pop()}-origin.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: repo });
  return bare;
}
