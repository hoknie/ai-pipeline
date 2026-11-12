import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/ui/forms/button.tsx';
import type { GroupCtx } from './useGroupCtx.ts';

/** Turns on follow mode of the journal; shown on the journal tab only while the mode is off. */
export function WatchButton({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  if (ctx.tabs.tab !== 'log' || ctx.watch.following) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      title={t('runs.group.watchTitle')}
      onClick={ctx.watch.follow}
    >
      <Eye />
      {t('runs.group.watch')}
    </Button>
  );
}
