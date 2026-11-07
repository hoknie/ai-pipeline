import { type Tag, knownTags } from '../../../feature/tags/types/index.ts';
import type { TagView } from '../contract/responses/tags.ts';

export function tagViews(catalog: readonly Tag[], ids: readonly string[]): TagView[] {
  const byId = new Map(catalog.map((tag) => [tag.id, tag]));
  return knownTags(catalog, ids).flatMap((id) => {
    const tag = byId.get(id);
    return tag
      ? [
          {
            id: tag.id,
            repository: tag.repository,
            name: tag.name,
            color: tag.color,
            task: tag.task,
          },
        ]
      : [];
  });
}
