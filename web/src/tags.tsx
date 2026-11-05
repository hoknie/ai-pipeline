import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { TagView } from './types.ts';

/**
 * The tag catalogs as the panel knows them now. Every repository has its own catalog; chips
 * resolve tags by id from all of them, pickers and filters take the catalog of one repository.
 */
export interface TagCatalog {
  /** The tags of every repository. */
  tags: TagView[];
  byId: Map<string, TagView>;
  /** The tags of one repository; none for `null`. */
  of: (repository: string | null) => TagView[];
  /**
   * Takes the fresher catalog of one repository that an answer of the API carries, before the
   * event arrives.
   */
  update: (repository: string, tags: TagView[]) => void;
}

export function catalogOf(
  tags: TagView[],
  update: (repository: string, tags: TagView[]) => void = () => {},
): TagCatalog {
  return {
    tags,
    byId: new Map(tags.map((tag) => [tag.id, tag])),
    of: (repository) =>
      repository === null ? [] : tags.filter((tag) => tag.repository === repository),
    update,
  };
}

const EMPTY = catalogOf([]);
const TagsContext = createContext<TagCatalog>(EMPTY);

export function TagsProvider({
  tags,
  onTags,
  children,
}: {
  tags: TagView[];
  onTags?: (repository: string, tags: TagView[]) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => catalogOf(tags, onTags), [tags, onTags]);
  return <TagsContext value={value}>{children}</TagsContext>;
}

export function useTags(): TagCatalog {
  return useContext(TagsContext);
}
