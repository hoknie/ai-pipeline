import type { RefObject } from 'react';

import type { Api } from '../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../shared/api/types.ts';
import { ModelCatalogProvider } from '../../shared/lib/catalog/models.tsx';
import { SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { SharedPipelineEditor } from './sharedFiles/SharedPipelineEditor.tsx';
import { SharedPipelinesSide } from './sharedFiles/SharedPipelinesSide.tsx';
import { useSharedPipelines } from './sharedFiles/useSharedPipelines.ts';

export { NEW_SHARED_PIPELINE } from './sharedFiles/constants.ts';

/**
 * The group «Pipeline» of the shared tab: the files of the shared pipelines directory, editable,
 * with the repositories that use each of them.
 */
export function SharedPipelinesGroup(props: {
  api: Api;
  config: ConfigEditorResponse;
  /** Id of the open pipeline, `new` for the new one, or null. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}) {
  const state = useSharedPipelines(props);
  return (
    <ModelCatalogProvider api={props.api}>
      <SplitPage side={<SharedPipelinesSide state={state} selected={props.selected} />}>
        <SharedPipelineEditor {...props} state={state} />
      </SplitPage>
    </ModelCatalogProvider>
  );
}
