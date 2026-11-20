import type { Resource } from '../../../../feature/access/types/index.ts';
import type { IpcContext } from '../types.ts';

export type Params = Record<string, unknown>;

/** What a call is done to: the resources to check, or any project the actor can reach. */
export interface Target {
  /** Every one of them must pass. */
  resources: Resource[];
  /** The action is allowed anywhere (a list the views filter by project). */
  anywhere?: boolean;
  /** A run or a task: a project the actor cannot read hides it (`not_found`). */
  hides?: string;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The shared level: no project. */
export const shared = (): Target => ({ resources: [{}] });

/** The action is allowed in any project; the answer is filtered by project. */
export const anywhere = (): Target => ({ resources: [], anywhere: true });

/** The project of the `repository` or `path` parameter; no parameter means anywhere. */
export function project(params: Params): Target {
  const repository = str(params.repository) ?? str(params.path);
  return repository === null ? anywhere() : { resources: [{ repository }] };
}

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => str(name) !== null) : [];

/** A new run or task: the project with the pipeline and the tags the call asks for. */
export function launch(params: Params): Target {
  const repository = str(params.repository);
  if (repository === null) return anywhere();
  const pipeline = str(params.pipeline);
  return {
    resources: [
      { repository, ...(pipeline === null ? {} : { pipeline }), tags: names(params.tags) },
    ],
  };
}

/** Every project of a list parameter. */
export function projects(params: Params): Target {
  const list = Array.isArray(params.repositories) ? params.repositories.filter((r) => str(r)) : [];
  const pipeline = str(params.pipeline);
  const tag = str(params.tag);
  return {
    resources: list.map((repository) => ({
      repository: String(repository),
      ...(pipeline === null ? {} : { pipeline }),
      tags: tag === null ? [] : [tag],
    })),
  };
}

function tagNames(context: IpcContext, repository: string, ids: string[]): string[] {
  const catalog = context.services.tags.of(repository);
  return ids.flatMap((id) => catalog.find((tag) => tag.id === id)?.name ?? []);
}

/** A run: its project, author, pipeline and tags. An unknown run has nothing to check. */
export function run(params: Params, context: IpcContext): Target {
  const id = str(params.runId);
  const state = id === null ? undefined : context.services.runs.states.lookup(id);
  if (id === null || state === undefined) return { resources: [] };
  const { repository, author, pipeline, tags } = state.run;
  return {
    resources: [{ repository, author, pipeline, tags: tagNames(context, repository, tags) }],
    hides: `unknown run \`${id}\``,
  };
}

/** A queue item: the project of its queue, its author, pipeline and tags. */
export function task(params: Params, context: IpcContext): Target {
  const id = str(params.item);
  const found = id === null ? undefined : context.services.queue.store.findItem(id);
  if (id === null || found === undefined) return project(params);
  const { queue, item } = found;
  return {
    resources: [
      {
        repository: queue.repository,
        author: item.author,
        pipeline: item.pipeline,
        tags: tagNames(context, queue.repository, item.tags),
      },
    ],
    hides: `unknown queue item \`${id}\``,
  };
}

/**
 * A task as an edit would leave it: the pipeline and the tags the call sets. Nothing to check
 * when the call sets neither.
 */
export function editedTask(params: Params, context: IpcContext): Target {
  const pipeline = str(params.pipeline);
  const tags = Array.isArray(params.tags) ? names(params.tags) : null;
  if (pipeline === null && tags === null) return { resources: [] };
  const current = task(params, context);
  return {
    resources: current.resources.map((resource) => ({
      ...resource,
      ...(pipeline === null ? {} : { pipeline }),
      ...(tags === null ? {} : { tags }),
    })),
  };
}

/** A run with the tags a `run_tags` call adds. */
export function taggedRun(params: Params, context: IpcContext): Target {
  const added = names(params.add);
  if (added.length === 0) return { resources: [] };
  const current = run(params, context);
  return {
    resources: current.resources.map((resource) => ({
      ...resource,
      tags: [...(resource.tags ?? []), ...added],
    })),
  };
}

/** One end of a link:a queue item or a run of the same task numbering. */
function linkEnd(ref: unknown, repository: string | null, context: IpcContext): Resource | null {
  if (typeof ref !== 'string' && typeof ref !== 'number') return null;
  try {
    const { id, ref: kind } = context.services.queue.links.resolveTaskRef(repository, ref);
    const found =
      kind === 'run'
        ? run({ runId: id }, context).resources[0]
        : task({ item: id }, context).resources[0];
    return found ?? null;
  } catch {
    // an unknown end: the method itself answers with its own error
    return null;
  }
}

/** The source and the target of a link: both ends must pass; one the actor cannot read is hidden. */
export function link(params: Params, context: IpcContext): Target {
  const repository = str(params.repository);
  const ends = [params.source, params.target]
    .map((ref) => linkEnd(ref, repository, context))
    .filter((end): end is Resource => end !== null);
  if (ends.length === 0) return project(params);
  return { resources: ends, hides: 'unknown task' };
}
