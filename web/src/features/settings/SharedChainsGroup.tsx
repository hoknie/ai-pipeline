import { useMemo, type RefObject } from 'react';

import type { Api } from '../../shared/api/api.ts';
import type { ConfigEditorResponse, EditorChain } from '../../shared/api/types.ts';
import { ModelCatalogProvider } from '../../shared/lib/catalog/models.tsx';
import { SplitPage } from '../../shared/ui/layout/EntryList.tsx';
import { ChainsList, ChainsPane, NEW_CHAIN } from '../specialists';

export { NEW_CHAIN as NEW_SHARED_CHAIN };

export function SharedChainsGroup(props: {
  api: Api;
  config: ConfigEditorResponse;
  selected: string | null;
  onSelect: (slug: string | null) => void;
  onReload: () => Promise<void>;
  dirty: RefObject<boolean>;
}) {
  const { api, config, selected, onSelect, onReload, dirty } = props;
  const sharedConfig = useMemo(() => {
    const chains = config.chains.flatMap((chain): EditorChain[] => {
      const source = chain.sources.global;
      return source ? [{ ...chain, ...source, level: 'global' }] : [];
    });
    return { ...config, chains };
  }, [config]);

  return (
    <ModelCatalogProvider api={api}>
      <SplitPage
        side={
          <ChainsList
            chains={sharedConfig.chains}
            loaded={true}
            selected={selected}
            onNew={() => onSelect(NEW_CHAIN)}
            onSelect={onSelect}
          />
        }
      >
        <ChainsPane
          api={api}
          view={sharedConfig}
          failure={null}
          selected={selected}
          dirty={dirty}
          scope="global"
          load={onReload}
          onSelect={onSelect}
        />
      </SplitPage>
    </ModelCatalogProvider>
  );
}
