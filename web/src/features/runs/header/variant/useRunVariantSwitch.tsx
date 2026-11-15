import { useState, type ReactNode } from 'react';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';
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
  // a finished run with a failed or cancelled group can be retried, so it may change its variant
  const retryable =
    run.groups.some((group) => group.status === 'failed' || group.status === 'cancelled') ||
    (run.split !== null &&
      run.split !== undefined &&
      (run.split.status === 'failed' || run.split.status === 'cancelled'));
  const switchable = (!run.finished || retryable) && variants.length > 1;
  return {
    open: switchable ? () => setOpened(true) : undefined,
    dialog: opened ? (
      <RunVariantDialog run={run} api={api} variants={variants} onClose={() => setOpened(false)} />
    ) : null,
  };
}
