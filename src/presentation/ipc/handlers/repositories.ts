import { catalogView } from '../views/index.ts';
import { searchLocalBranches } from '../../../platform/git/index.ts';
import { notFound } from '../../../platform/errors/index.ts';

import { visible } from './access/visible.ts';

import type { HandlerTable, IpcContext } from './types.ts';

/** The registry as the actor sees it: the projects it reads. */
const listed = (context: IpcContext) =>
  visible(context, context.snapshots.repositories(), (view) => view.path);

/** The registry of repositories and the tag catalogs. */
export const repositoryHandlers = {
  repositories: async (_params, context) => listed(context),
  repository_branches: async ({ repository, query, exact }, { services, actor }) => {
    const root = await services.registry.resolve(repository);
    if (!services.access.can(actor, 'project.read', { repository: root })) {
      throw notFound('ipc.guard', 'unknown repository');
    }
    return searchLocalBranches(root, query, exact);
  },
  repository_match: async (params, { services, actor }) => {
    const found = await services.projects.matchRemotes(params.remotes);
    // a project the actor cannot read is not there for the actor
    const project =
      found && services.access.can(actor, 'project.read', { repository: found.path })
        ? found
        : null;
    return {
      project: project
        ? { path: project.path, slug: project.slug ?? null, name: project.name }
        : null,
    };
  },
  repository_add: ({ path, ...attributes }, context) =>
    context.services.runs.engine.serial(async () => {
      await context.services.projects.add(path, attributes);
      return listed(context);
    }),
  repository_update: ({ path, ...changes }, context) =>
    context.services.runs.engine.serial(async () => {
      await context.services.compose.repositoryEdit.update(path, changes);
      return listed(context);
    }),
  repository_move: (params, context) =>
    context.services.runs.engine.serial(async () => {
      await context.services.compose.repositoryMove.move(params.path, params.to);
      return listed(context);
    }),
  repository_remove: (params, context) =>
    context.services.runs.engine.serial(async () => {
      await context.services.compose.repositoryRemoval.remove(params.path);
      return listed(context);
    }),
  tags: async (params, { services }) =>
    catalogView(await services.tags.catalogFor(params.repository)),
  tag_add: (params, { services }) =>
    services.runs.engine.serial(async () =>
      catalogView(services.tags.of(await services.tags.add(params))),
    ),
  tag_edit: (params, { services }) =>
    services.runs.engine.serial(async () =>
      catalogView(services.tags.of(await services.tags.edit(params))),
    ),
  tag_remove: (params, { services }) =>
    services.runs.engine.serial(async () =>
      catalogView(
        services.tags.of(
          await services.queue.taskTags.remove({
            repository: params.repository,
            tags: params.tags ?? (params.tag === undefined ? [] : [params.tag]),
          }),
        ),
      ),
    ),
} satisfies Partial<HandlerTable>;
