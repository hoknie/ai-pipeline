import { useState, type ReactNode } from 'react';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';
import { canSwitchRun } from '../switchable.ts';
import { RunVariantDialog } from './RunVariantDialog.tsx';
import { useRunVariants } from './useRunVariants.ts';

/**
 * The switch of the variant of the run: `open` for the menu «More», undefined when the run is
 * finished with nothing to retry or its pipeline has no variant besides `default`; `dialog` to
 * render in the header.
 */
export function useRunVariantSwitch(
  run: RunView,
  api: Api,
): { open: (() => void) | undefined; dialog: ReactNode } {
  const [opened, setOpened] = useState(false);
  const variants = useRunVariants(run, api);
  const switchable = canSwitchRun(run) && variants.length > 1;
  return {
    open: switchable ? () => setOpened(true) : undefined,
    dialog: opened ? (
      <RunVariantDialog run={run} api={api} variants={variants} onClose={() => setOpened(false)} />
    ) : null,
  };
}
