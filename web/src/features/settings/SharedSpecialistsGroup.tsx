import { ModelCatalogProvider } from '../../shared/lib/catalog/models.tsx';
import type { RefObject } from 'react';

import type { Api } from '../../shared/api/api.ts';
import type { ConfigEditorResponse } from '../../shared/api/types.ts';
import { SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { SharedSpecialistEditor } from './sharedFiles/SharedSpecialistEditor.tsx';
import { SharedSpecialistsSide } from './sharedFiles/SharedSpecialistsSide.tsx';
import { useSharedSpecialists } from './sharedFiles/useSharedSpecialists.ts';

export { NEW_SHARED } from './sharedFiles/constants.ts';

/**
 * The group «Specialists» of the shared tab: the files of the shared specialists directory, editable,
 * with the repositories that use each of them.
 */
export function SharedSpecialistsGroup(props: {
  api: Api;
  config: ConfigEditorResponse;
  /** Slug of the open specialist, `new` for the new one, or null. */
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}) {
  const state = useSharedSpecialists(props);
  return (
    <ModelCatalogProvider api={props.api}>
      <SplitPage side={<SharedSpecialistsSide state={state} selected={props.selected} />}>
        <SharedSpecialistEditor {...props} state={state} />
      </SplitPage>
    </ModelCatalogProvider>
  );
}
