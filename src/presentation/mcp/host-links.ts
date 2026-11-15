import { z } from 'zod';

import { repositoryArgument } from '../ipc/client/index.ts';
import { attempt } from './tools.ts';
import { withData, type HostKit } from './host-kit.ts';

/** The links a task may have; `after` and `parent` are their short form and cannot be passed too. */
export const linkInputs = z
  .array(
    z.object({
      kind: z
        .string()
        .describe(
          'One of: blocked_by (the task waits for the target), parent, related, duplicates',
        ),
      target: z
        .union([z.string(), z.number().int().positive()])
        .describe(
          'Id of a queue item or run of any project, or a task number of the repository (7 or #7)',
        ),
    }),
  )
  .optional()
  .describe(
    'Links of the task instead of after and parent (passing both is an error). Edit replaces every link of the task; [] removes them',
  );

const taskRef = z
  .union([z.string(), z.number().int().positive()])
  .describe(
    'Id of a queue item or run of any project, or a task number of the repository (7 or #7)',
  );

const linkKind = z
  .string()
  .describe(
    'Kind of the link: blocked_by (the source waits for the target), parent (the target is the parent task), related (a symmetric note), duplicates (the source duplicates the target)',
  );

type TaskLinkCall = {
  source: string | number;
  kind: string;
  target: string | number;
  repo?: string | undefined;
};

/** `task_link` and `task_unlink` of the daemon: connect any two tasks, started or waiting. */
export function registerTaskLinks(kit: HostKit): void {
  const { server, options, repo } = kit;
  const change =
    (method: 'task_link' | 'task_unlink', verb: string) =>
    ({ source, kind, target, repo: where }: TaskLinkCall) =>
      attempt(async () => {
        const view = await options.send(method, {
          source,
          kind,
          target,
          ...(where === undefined ? {} : { repository: repositoryArgument(where, options.cwd) }),
        });
        return withData(verb, view);
      });

  server.registerTool(
    'swarm_task_link',
    {
      title: 'Link two tasks',
      description:
        'Connect two tasks of any project: a queue item or a run, waiting or finished. The kinds: blocked_by (the source waits for the target), parent (the target is the parent task of the source; a second parent replaces the first), related (a symmetric note, shows for both), duplicates (the source duplicates the target). A link of a queue item moves to its run when the item starts. Repo names the repository for task numbers.',
      inputSchema: { source: taskRef, kind: linkKind, target: taskRef, repo },
    },
    change('task_link', 'Linked.'),
  );

  server.registerTool(
    'swarm_task_unlink',
    {
      title: 'Unlink two tasks',
      description:
        'Remove the link of the kind between two tasks; a link that is not there changes nothing. A `related` link is removed from either side. Repo names the repository for task numbers.',
      inputSchema: { source: taskRef, kind: linkKind, target: taskRef, repo },
    },
    change('task_unlink', 'Unlinked.'),
  );
}

/** The entries of `fields` that are set, for spreading into a request. */
export const present = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
