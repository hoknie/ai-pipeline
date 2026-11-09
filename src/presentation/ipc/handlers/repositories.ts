import { catalogView } from '../views/index.ts';

import type { HandlerTable } from './types.ts';

/** The registry of repositories and the tag catalogs. */
export const repositoryHandlers = {
  repositories: async (_params, { snapshots }) => snapshots.repositories(),
  repository_add: ({ path, ...attributes }, { services, snapshots }) =>
    services.runs.engine.serial(async () => {
      await services.projects.add(path, attributes);
      return snapshots.repositories();
    }),
  repository_update: ({ path, ...changes }, { services, snapshots }) =>
    services.runs.engine.serial(async () => {
      await services.compose.repositoryEdit.update(path, changes);
      return snapshots.repositories();
    }),
  repository_move: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () => {
      await services.compose.repositoryMove.move(params.path, params.to);
      return snapshots.repositories();
    }),
  repository_remove: (params, { services, snapshots }) =>
    services.runs.engine.serial(async () => {
      await services.compose.repositoryRemoval.remove(params.path);
      return snapshots.repositories();
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
      catalogView(services.tags.of(await services.queue.taskTags.remove(params))),
    ),
} satisfies Partial<HandlerTable>;
