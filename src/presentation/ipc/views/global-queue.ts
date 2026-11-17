import {
  type GlobalQueue,
  type Queue,
  type QueueItem,
  type ItemLookup,
  takesProject,
  takesTags,
} from '../../../feature/queue/types/index.ts';
import type { RunAttachment, RunState } from '../../../feature/runs/types/index.ts';
import type { Tag } from '../../../feature/tags/types/index.ts';
import type { GlobalQueueView, QueueRunView } from '../contract/index.ts';
import type { WaitLookup } from '../contract/responses/runs.ts';
import { queueView } from './queue.ts';
import { tagViews } from './tags.ts';

/** What the view of the global queue needs to know about each project. */
export interface GlobalViewSources {
  lookup: (id: string) => RunState | undefined;
  waits: WaitLookup;
  attachments: (item: string) => RunAttachment[];
  find: ItemLookup;
  links?: Parameters<typeof queueView>[10];
  /** `queue.max`. */
  max: number;
  /** The root of the project whose queue holds the item. */
  ownerOf: (item: QueueItem) => string;
  /** Names of pipelines and the tag catalog of a project. */
  project: (repository: string) => {
    names: (id: string) => string;
    variantNames: (pipeline: string, variant: string) => string;
    providerNames: (slug: string) => string | null;
    catalog: readonly Tag[];
  };
}

/** The global queue: `line` holds its state and the waiting tasks of all projects in the global order. */
export function globalQueueView(
  global: GlobalQueue,
  line: Queue,
  sources: GlobalViewSources,
): GlobalQueueView {
  const { lookup, ownerOf, project } = sources;
  const {
    scope: _scope,
    repository: _repository,
    autoDeliver: _autoDeliver,
    deliveryMode: _deliveryMode,
    filter,
    filterTags: _filterTags,
    items,
    runs,
    skipped,
    ...rest
  } = queueView(
    line,
    lookup,
    null,
    [],
    null,
    sources.waits,
    (id) => id,
    (_pipeline, variant) => variant,
    sources.attachments,
    sources.find,
    sources.links,
  );
  const ofRun = (view: QueueRunView) => {
    const state = lookup(view.id);
    const repository = state?.run.repository ?? '';
    const { names, variantNames, catalog } = project(repository);
    return {
      ...view,
      repository,
      pipelineName: names(view.pipeline),
      variantName: variantNames(view.pipeline, view.variant),
      tags: state ? tagViews(catalog, state.run.tags) : [],
    };
  };
  return {
    ...rest,
    scope: 'global',
    filter: {
      pipelines: filter.pipelines,
      projects: [...global.filter.projects],
      tags: [...global.filter.tags],
    },
    max: sources.max,
    items: items.map((view, index) => {
      const item = line.items[index]!;
      const repository = ownerOf(item);
      const { names, variantNames, providerNames, catalog } = project(repository);
      return {
        ...view,
        repository,
        pipelineName: names(view.pipeline),
        variantName: variantNames(view.pipeline, view.variant),
        providerName:
          view.provider === null ? null : (view.providerName ?? providerNames(view.provider)),
        tags: tagViews(catalog, item.tags),
        filtered:
          view.filtered ||
          !takesProject(global.filter, repository) ||
          (item.run === null && !takesTags(global.filter, item.tags, catalog)),
      };
    }),
    runs: runs.map(ofRun),
    skipped: skipped.map(ofRun),
  };
}
