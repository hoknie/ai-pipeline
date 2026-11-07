import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import type { Api } from '../../../shared/api/api.ts';
import type { GroupView, RunView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';

/** Confirms `apply --force`, listing why each pending group was refused and its files. */
export function ApplyDialog({
  run,
  api,
  onConfirm,
  onClose,
}: {
  run: RunView;
  api: Api;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  useEffect(() => {
    const pending = run.groups.filter(
      (group) => group.status === 'merged' && group.delivery !== 'applied',
    );
    void Promise.all(pending.map((group) => api.group(run.id, group.slug))).then(setGroups, () =>
      setGroups([]),
    );
  }, [api, run]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('runs.apply.title')}</DialogTitle>
          <DialogDescription>{t('runs.apply.description')}</DialogDescription>
        </DialogHeader>
        {groups === null ? <Skeleton className="h-12" /> : null}
        {groups?.map((group) => (
          <section key={group.slug} className="text-sm">
            <b>{group.title}</b>
            {group.delivery.reason ? (
              <p className="text-status-warn">{group.delivery.reason}</p>
            ) : null}
            <ul className="mt-1 list-disc pl-5">
              {group.delivery.files.map((file) => (
                <li key={file}>
                  <FilePath path={file} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('runs.apply.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
