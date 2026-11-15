import { useEffect, useRef, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { PipelinesView } from '../../../shared/api/types.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';

/** The pipelines of each project, loaded once per set of projects through the project's api. */
export function useProjectPipelines(
  api: Api,
  paths: readonly string[],
): ReadonlyMap<string, PipelinesView> {
  const [byPath, setByPath] = useState<ReadonlyMap<string, PipelinesView>>(new Map());
  const key = paths.join('\n');
  useEffect(() => {
    let alive = true;
    for (const path of key === '' ? [] : key.split('\n')) {
      api
        .forRepository(path)
        .pipelines()
        .then((view) => {
          if (alive) setByPath((current) => new Map(current).set(path, view));
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [api, key]);
  return byPath;
}

/** Loads the tags of the projects the catalog does not know yet: the edit form offers them. */
export function useProjectTags(api: Api, paths: readonly string[]): void {
  const catalog = useTags();
  const asked = useRef(new Set<string>());
  const key = paths.join('\n');
  useEffect(() => {
    for (const path of key === '' ? [] : key.split('\n')) {
      if (asked.current.has(path) || catalog.of(path).length > 0) continue;
      asked.current.add(path);
      api
        .forRepository(path)
        .tags()
        .then((tags) => catalog.update(path, tags))
        .catch(() => asked.current.delete(path));
    }
  }, [api, key, catalog]);
}
