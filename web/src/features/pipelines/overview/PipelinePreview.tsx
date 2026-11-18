import { useMemo } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, EditorPipeline } from '../../../shared/api/types.ts';
import { ModelCatalogProvider } from '../../../shared/lib/catalog/models.tsx';
import type { ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { actionsOf } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { ActionForm } from '../ActionForm.tsx';
import { PipelineForm } from '../form/PipelineForm.tsx';

const noop = () => {};
const noopAsync = async () => {};

/**
 * A pipeline or an action in one project (or its shared file), in the form of the page with every
 * field disabled and no way to write. The sticky bar of the action stays in its place here.
 */
export function PipelinePreview({
  api,
  project,
  choice,
  view,
  id,
  isAction,
}: {
  api: Api;
  project: ProjectRef;
  /** The value of the choice shown: a project slug, or the shared one. */
  choice: string;
  view: ConfigEditorResponse;
  id: string;
  isAction: boolean;
}) {
  const projectApi = useMemo(() => api.forRepository(project.path), [api, project.path]);
  const body = isAction ? (
    <ActionForm
      api={projectApi}
      view={view}
      action={actionsOf(view).find((item) => item.id === id) ?? null}
      notice={null}
      locked
      onDirty={noop}
      onReload={noopAsync}
      onSaved={noopAsync}
      onDeleted={noopAsync}
    />
  ) : (
    <PipelineForm
      api={projectApi}
      view={view}
      pipeline={(view.pipelines as EditorPipeline[]).find((item) => item.id === id) ?? null}
      activeRuns={0}
      notice={null}
      locked
      onDirty={noop}
      onReload={noopAsync}
      onSaved={noopAsync}
      onDeleted={noopAsync}
    />
  );
  return (
    <ModelCatalogProvider api={projectApi}>
      <div
        data-entry-preview={choice}
        className="flex flex-col gap-2 [&_[data-sticky]]:static [&_[data-sticky]]:m-0 [&_[data-sticky]]:px-0"
      >
        {body}
      </div>
    </ModelCatalogProvider>
  );
}
