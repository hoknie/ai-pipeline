import type { Tag } from '../../../feature/tags/types/index.ts';
import type { TagView } from '../contract/responses/tags.ts';

/** The catalog sorted by repository, then by name ignoring case. */
export function catalogView(catalog: readonly Tag[]): TagView[] {
  return [...catalog]
    .sort(
      (a, b) =>
        a.repository.localeCompare(b.repository, 'en') ||
        a.name.toLocaleLowerCase('und').localeCompare(b.name.toLocaleLowerCase('und'), 'en') ||
        a.id.localeCompare(b.id, 'en'),
    )
    .map(({ id, repository, name, color, task }) => ({ id, repository, name, color, task }));
}
