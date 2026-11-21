import { useTranslation } from 'react-i18next';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';
import type { Access } from '../../../../shared/lib/access/useAccess.ts';
import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import { useConfirm } from '../../../../shared/ui/overlays/confirm.tsx';

/**
 * «Clean up»: removes the worktrees and service refs of a finished run after a confirmation. The
 * dialog warns about merged groups that are not delivered: their changes stay in the patch only.
 */
export function useRunCleanup(
  run: RunView,
  api: Api,
  onError: (message: string) => void,
  access?: Access,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const undelivered = run.delivery.merged > run.delivery.applied;
  const allowed = access?.can('run.cancel', run.author?.id) ?? true;
  const clean = async () => {
    const yes = await confirm({
      title: t('runs.header.cleanTitle'),
      description: [
        t('runs.header.cleanDescription'),
        ...(undelivered ? [t('runs.header.cleanUndelivered')] : []),
      ].join('\n\n'),
      confirmLabel: t('runs.header.cleanConfirm'),
      cancelLabel: t('runs.header.cleanKeep'),
      destructive: true,
    });
    if (!yes) return;
    try {
      await api.cleanRun(run.id);
      notifySuccess(t('runs.header.cleaned'));
    } catch (error) {
      onError((error as Error).message);
    }
  };
  return {
    clean,
    /** The run is finished and not cleaned up yet. */
    cleanable: run.cleanable,
    /** The task of the run stands in the queue: removing it cleans the run up. */
    queued: run.queueItem !== null,
    cleanAllowed: allowed,
    cleanHint: allowed ? undefined : access?.hint('run.cancel', run.author?.id),
  };
}
