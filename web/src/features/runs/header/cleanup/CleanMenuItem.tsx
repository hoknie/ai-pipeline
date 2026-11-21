import { useTranslation } from 'react-i18next';

import { DropdownMenuItem } from '../../../../shared/ui/overlays/dropdown-menu.tsx';
import type { useRunCleanup } from './useRunCleanup.ts';

/** «Clean up…» of the menu «More»: off while the run is active or already cleaned up. */
export function CleanMenuItem({ cleanup }: { cleanup: ReturnType<typeof useRunCleanup> }) {
  const { t } = useTranslation();
  const title = !cleanup.cleanAllowed
    ? cleanup.cleanHint
    : cleanup.queued
      ? t('runs.header.cleanQueued')
      : t('runs.header.cleanHint');
  return (
    <DropdownMenuItem
      disabled={!cleanup.cleanable || !cleanup.cleanAllowed}
      title={title}
      onSelect={() => void cleanup.clean()}
    >
      {t('runs.header.clean')}
    </DropdownMenuItem>
  );
}
