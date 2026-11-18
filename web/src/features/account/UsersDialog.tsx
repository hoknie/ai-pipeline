import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../shared/ui/overlays/dialog.tsx';

import { listUsers, setUserDisabled, type UserRow } from './accountApi.ts';

/** «Users» for an administrator: who may sign in, with the source and a switch to disable. */
export function UsersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    listUsers().then(setUsers, (reason: Error) => setError(reason.message));
  }, []);
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);
  const toggle = async (user: UserRow) => {
    setError(null);
    try {
      await setUserDisabled(user.email, !user.disabled);
      reload();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('account.users.title')}</DialogTitle>
        </DialogHeader>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className="space-y-1 text-sm">
          {users.map((user) => (
            <li key={user.id} className="flex items-center justify-between gap-2">
              <span>
                <b>{user.email}</b> {user.name} · {user.source}
                {user.admin ? ` · ${t('account.users.admin')}` : ''}
                {user.disabled ? ` · ${t('account.users.disabled')}` : ''}
              </span>
              <Button variant="outline" size="sm" onClick={() => void toggle(user)}>
                {user.disabled ? t('account.users.enable') : t('account.users.disable')}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
