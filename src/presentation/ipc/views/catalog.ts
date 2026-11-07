import type { Tag } from '../../../feature/tags/types/index.ts';
import type { TagView } from '../contract/responses/tags.ts';

/** The catalog sorted by repository, then by name ignoring case. */
export function catalogView(catalog: readonly Tag[]): TagView[] {
  return [...catalog]
    .sort(
      (a, b) =>
        a.repository.localeCompare(b.repository) ||
        a.name.toLocaleLowerCase('und').localeCompare(b.name.toLocaleLowerCase('und')) ||
        a.id.localeCompare(b.id),
    )
    .map(({ id, repository, name, color, task }) => ({ id, repository, name, color, task }));
}
