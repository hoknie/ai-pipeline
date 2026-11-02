import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { TagView } from './types.ts';

/** The tag catalog as the panel knows it now; chips and pickers resolve tags by id from it. */
export interface TagCatalog {
  tags: TagView[];
  byId: Map<string, TagView>;
  /** Takes the fresher catalog that an answer of the API carries, before the event arrives. */
  update: (tags: TagView[]) => void;
}

export function catalogOf(
  tags: TagView[],
  update: (tags: TagView[]) => void = () => {},
): TagCatalog {
  return { tags, byId: new Map(tags.map((tag) => [tag.id, tag])), update };
}

const EMPTY = catalogOf([]);
const TagsContext = createContext<TagCatalog>(EMPTY);

export function TagsProvider({
  tags,
  onTags,
  children,
}: {
  tags: TagView[];
  onTags?: (tags: TagView[]) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => catalogOf(tags, onTags), [tags, onTags]);
  return <TagsContext value={value}>{children}</TagsContext>;
}

export function useTags(): TagCatalog {
  return useContext(TagsContext);
}
