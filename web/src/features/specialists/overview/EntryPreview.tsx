import { useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import type { ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { ModelCatalogProvider } from '../../../shared/lib/catalog/models.tsx';
import { ChainsPane } from '../chains/ChainsPane.tsx';
import { SpecialistPane } from '../page/SpecialistPane.tsx';
import type { SpecialistsSource } from '../page/useAllSpecialistsData.ts';

const noop = () => {};

/**
 * The configuration of an entry in one project (or its shared file), in the form of the page with
 * every field disabled and no way to write. The sticky bar of the form stays in its place here:
 * its negative margins only fit the top of the page.
 */
export function EntryPreview({
  api,
  data,
  project,
  choice,
  view,
  slug,
  isChains,
}: {
  api: Api;
  data: SpecialistsSource;
  project: ProjectRef;
  /** The value of the choice shown: a project slug, or the shared one. */
  choice: string;
  view: ConfigEditorResponse;
  slug: string;
  isChains: boolean;
}) {
  const projectApi = useMemo(() => api.forRepository(project.path), [api, project.path]);
  const dirty = useMemo(() => ({ current: false }), []);
  return (
    <ModelCatalogProvider api={projectApi}>
      <div
        data-entry-preview={choice}
        className="flex flex-col gap-2 [&_[data-sticky]]:static [&_[data-sticky]]:m-0 [&_[data-sticky]]:px-0"
      >
        {isChains ? (
          <ChainsPane
            api={projectApi}
            view={view}
            failure={null}
            selected={slug}
            dirty={dirty}
            locked
            load={data.load}
            onSelect={noop}
          />
        ) : (
          <SpecialistPane
            api={projectApi}
            view={view}
            failure={null}
            catalog={data.catalog}
            catalogError={data.catalogError}
            selected={slug}
            notice={null}
            dirty={dirty}
            locked
            load={data.load}
            onSelect={noop}
            onNotice={noop}
          />
        )}
      </div>
    </ModelCatalogProvider>
  );
}
