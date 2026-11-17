import { useState, type ReactNode } from 'react';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';
import { canSwitchRun } from '../switchable.ts';
import { RunProviderDialog } from './RunProviderDialog.tsx';
import { useRunProviders } from './useRunProviders.ts';

/**
 * The switch of the provider of the run: `open` for the menu «More», undefined when the run cannot
 * change (finished with nothing to retry) or the project has no provider; `dialog` to render in the
 * header.
 */
export function useRunProviderSwitch(
  run: RunView,
  api: Api,
): { open: (() => void) | undefined; dialog: ReactNode } {
  const [opened, setOpened] = useState(false);
  const { providers, scoped } = useRunProviders(run, api);
  const switchable = canSwitchRun(run) && providers.length > 0;
  return {
    open: switchable ? () => setOpened(true) : undefined,
    dialog: opened ? (
      <RunProviderDialog
        run={run}
        api={scoped}
        providers={providers}
        onClose={() => setOpened(false)}
      />
    ) : null,
  };
}
