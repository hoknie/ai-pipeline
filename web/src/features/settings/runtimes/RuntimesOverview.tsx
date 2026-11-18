import { useTranslation } from 'react-i18next';

import { RuntimesList } from './RuntimesList.tsx';
import type { RuntimeRow } from './runtimeRows.ts';

/** The right part while no runtime is chosen: a hint and every runtime across the width. */
export function RuntimesOverview({
  rows,
  titleOf,
  onOpen,
}: {
  rows: RuntimeRow[];
  titleOf: (key: string) => string;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('settingsPage.runtimes.choose')}</p>
      <RuntimesList rows={rows} selected={null} narrow={false} titleOf={titleOf} onOpen={onOpen} />
    </div>
  );
}
