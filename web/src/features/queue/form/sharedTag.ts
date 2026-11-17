import type { PipelinesView, QueueFields, QueueProjectsFields } from '../../../shared/api/types.ts';

/** The longest name of a tag. */
const TAG_LIMIT = 30;

/** The shared tag a title gives: at most 30 characters, cut after the last whole word. */
export function defaultSharedTag(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  const chars = [...clean];
  if (chars.length <= TAG_LIMIT) return clean;
  const cut = chars.slice(0, TAG_LIMIT).join('');
  if (chars[TAG_LIMIT] === ' ') return cut.trimEnd();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * The pipelines every project has, in the order of the first project: a pipeline stays when all
 * the projects have it; its variants and steps are those they all have. Null until every project
 * is loaded.
 */
export function commonPipelines(
  views: readonly (PipelinesView | undefined)[],
): PipelinesView | null {
  const loaded = views.filter((view): view is PipelinesView => view !== undefined);
  const [first] = loaded;
  if (first === undefined || loaded.length < views.length) return null;
  const pipelines = first.pipelines.flatMap((pipeline) => {
    const others = loaded.slice(1).map((view) => view.pipelines.find((x) => x.id === pipeline.id));
    if (others.some((other) => other === undefined)) return [];
    const found = others.flatMap((other) => other ?? []);
    const shared = <T extends { id: string }>(
      list: T[],
      pick: (other: (typeof found)[number]) => T[],
    ) =>
      list.filter((entry) =>
        found.every((other) => pick(other).some((candidate) => candidate.id === entry.id)),
      );
    return [
      {
        ...pipeline,
        variants: shared(pipeline.variants, (other) => other.variants),
        steps: shared(pipeline.steps, (other) => other.steps),
      },
    ];
  });
  const providers = first.providers.filter((id) =>
    loaded.every((view) => view.providers.includes(id)),
  );
  return { ...first, pipelines, providers };
}

/** The request of a task of several projects from the fields of the form. */
export function projectsFields(
  fields: QueueFields,
  input: { projects: string[]; notes: Record<string, string>; tag: string; chain: boolean },
): QueueProjectsFields {
  const notes = Object.fromEntries(
    input.projects.flatMap((project) => {
      const note = (input.notes[project] ?? '').trim();
      return note === '' ? [] : [[project, note] as const];
    }),
  );
  const tag = input.tag.trim();
  return {
    repositories: input.projects,
    pipeline: fields.pipeline,
    task: fields.task ?? '',
    ...(fields.variant !== undefined ? { variant: fields.variant } : {}),
    ...(typeof fields.provider === 'string' ? { provider: fields.provider } : {}),
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.postponed ? { postponed: true } : {}),
    ...(fields.autoDeliver !== undefined ? { autoDeliver: fields.autoDeliver } : {}),
    ...(fields.deliveryMode !== undefined ? { deliveryMode: fields.deliveryMode } : {}),
    ...(fields.skip !== undefined && fields.skip.length > 0 ? { skip: fields.skip } : {}),
    ...((fields.links ?? []).some((link) => link.kind === 'blocked_by')
      ? {
          after: (fields.links ?? [])
            .filter((link) => link.kind === 'blocked_by')
            .map((link) => String(link.target)),
        }
      : {}),
    ...(Object.keys(notes).length > 0 ? { notes } : {}),
    ...(tag !== '' ? { tag } : {}),
    ...(input.chain ? { chain: true } : {}),
  };
}
