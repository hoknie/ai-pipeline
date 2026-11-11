import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { notifyError, notifySuccess } from '../../shared/lib/browser/notify.ts';
import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { Button } from '../../shared/ui/forms/button.tsx';
import { useConfirm } from '../../shared/ui/overlays/confirm.tsx';

/** «Clear statistics» of a project: asks first, then clears, tells how many records went. */
export function ClearProjectAction({
  api,
  repository,
  onCleared,
}: {
  api: Api;
  repository: string;
  onCleared: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const name = repositoryLabel(repository);
  const clear = async () => {
    const accepted = await confirm({
      title: t('stats.clear.title', { name }),
      description: t('stats.clear.description'),
      confirmLabel: t('stats.clear.confirm'),
      destructive: true,
    });
    if (!accepted) return;
    try {
      const { removed } = await api.statsClear(repository);
      notifySuccess(t('stats.clear.done', { count: removed, name }));
      onCleared();
    } catch (failure) {
      notifyError(failure);
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t('stats.clear.action', { name })}
      title={t('stats.clear.action', { name })}
      onClick={() => void clear()}
    >
      <Trash2 />
    </Button>
  );
}
