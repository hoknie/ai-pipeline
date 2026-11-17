import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProviderView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { useProvidersScope } from '../page/scope.ts';
import { clearHolders } from './removal.ts';

/**
 * A role that providers still hold models of: the dialog lists them and clears their cells one
 * by one before the role itself goes; it stops at the first refusal and says who is cleared.
 */
export function RemoveRoleDialog({
  api,
  editor,
  role,
  name,
  holders,
  removeRole,
  onDone,
  onClose,
}: {
  api: Api;
  editor: ConfigEditorResponse;
  role: string;
  name: string;
  holders: ProviderView[];
  /** Writes the roles without this one; resolves to an error text, or null when it was accepted. */
  removeRole: () => Promise<string | null>;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<string[]>([]);
  const run = async () => {
    setBusy(true);
    setError(null);
    const todo = holders.filter((holder) => !cleared.includes(holder.slug));
    const result = await clearHolders(api, editor, todo, role, scope);
    const done = [...cleared, ...result.cleared];
    setCleared(done);
    const failure = result.error ?? (await removeRole());
    setBusy(false);
    if (failure === null) onDone();
    else setError(failure);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('providers.roles.removeTitle', { name })}</DialogTitle>
          <DialogDescription>{t('providers.roles.removeHeld')}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc pl-5 text-sm">
          {holders.map((holder) => (
            <li key={holder.slug}>
              {holder.name} <span className="text-muted-foreground">({holder.slug})</span>
              {cleared.includes(holder.slug) ? ` — ${t('providers.roles.cleared')}` : ''}
            </li>
          ))}
        </ul>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {error && cleared.length > 0 ? (
          <p role="status" className="text-sm">
            {t('providers.roles.alreadyCleared', { providers: cleared.join(', ') })}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run()}>
            {t('providers.roles.clearAndRemove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
