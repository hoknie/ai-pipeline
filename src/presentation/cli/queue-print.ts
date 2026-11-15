import { formatQueue, type Style } from '../format/index.ts';
import type { GlobalQueueView, QueueView, RepositoryView } from '../ipc/contract/index.ts';
import type { Command } from 'commander';

import { call, type Context } from './context.ts';

/** Prints the queue; the registry names the projects of predecessors from other projects. */
export async function printQueue(
  json: boolean | undefined,
  view: QueueView | GlobalQueueView,
  ctx: Context,
  style: Style,
  output: (json: boolean | undefined, text: string, data: unknown) => void,
  repoGiven = false,
): Promise<void> {
  if (view.scope === 'global' && repoGiven) {
    ctx.io.stderr('aip: warning: queue scope is global: --repo is ignored\n');
  }
  const foreign = view.items.some((item) =>
    item.after.some(
      (dependency) =>
        dependency.repository !== null &&
        dependency.repository !== ('repository' in view ? view.repository : null),
    ),
  );
  const projects =
    (foreign || view.scope === 'global') && !json
      ? ((await call(ctx, 'repositories', {})) as RepositoryView[])
      : [];
  output(json, formatQueue(view, style, projects), view);
}

/** The commands for which `--repo` means nothing in the global mode. */
const REPO_IGNORED_BY = new Set(['list', 'start', 'pause', 'parallel', 'settings']);

/** Remembers whether such a command of `queue` got `--repo` by hand; in the global mode it is ignored. */
export function watchRepo(queue: Command): () => boolean {
  let given = false;
  queue.hook('preAction', (_parent, action) => {
    given = REPO_IGNORED_BY.has(action.name()) && action.getOptionValueSource('repo') === 'cli';
  });
  return () => given;
}
