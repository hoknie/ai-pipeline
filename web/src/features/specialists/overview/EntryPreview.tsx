import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../../shared/api/types.ts';
import type { ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { ModelCatalogProvider } from '../../../shared/lib/catalog/models.tsx';
import { ChainsPane } from '../chains/ChainsPane.tsx';
import { SpecialistPane } from '../page/SpecialistPane.tsx';
import type { SpecialistsSource } from '../page/useAllSpecialistsData.ts';

const noop = () => {};

/**
 * The configuration of an entry in one project, in the form of the page with every field
 * disabled and no way to write.
 */
export function EntryPreview({
  api,
  data,
  project,
  view,
  slug,
  isChains,
}: {
  api: Api;
  data: SpecialistsSource;
  project: ProjectRef;
  view: ConfigEditorResponse;
  slug: string;
  isChains: boolean;
}) {
  const { t } = useTranslation();
  const projectApi = useMemo(() => api.forRepository(project.path), [api, project.path]);
  const dirty = useMemo(() => ({ current: false }), []);
  return (
    <ModelCatalogProvider api={projectApi}>
      <div data-entry-preview={project.slug} className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {t('projectOverview.preview', { project: project.label })}
        </p>
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
