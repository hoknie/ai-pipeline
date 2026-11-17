import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../../shared/api/api.ts';
import type { RunView } from '../../../../shared/api/types.ts';
import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import { Alert } from '../../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../shared/ui/overlays/dialog.tsx';

/** Picks another provider of the tiers for an unfinished run (or none) and asks the daemon to switch. */
export function RunProviderDialog({
  run,
  api,
  providers,
  onClose,
}: {
  run: RunView;
  api: Api;
  providers: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const current = run.provider ?? null;
  const [chosen, setChosen] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setRunProvider(run.id, chosen);
      notifySuccess(t('runs.header.providerChanged'));
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };
  const options: { id: string | null; label: string }[] = [
    { id: null, label: t('runs.header.providerNone') },
    ...providers.map((id) => ({ id, label: id })),
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('runs.header.changeProviderTitle')}</DialogTitle>
          <DialogDescription>{t('runs.header.changeProviderDescription')}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" className="flex flex-col gap-2">
          {options.map((option) => (
            <label key={option.id ?? 'none'} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="run-provider"
                value={option.id ?? ''}
                checked={chosen === option.id}
                disabled={busy}
                onChange={() => setChosen(option.id)}
              />
              {option.label}
              {option.id === current ? (
                <span className="text-xs text-muted-foreground">
                  {t('runs.header.providerCurrent')}
                </span>
              ) : null}
            </label>
          ))}
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('runs.header.changeProviderKeep')}
          </Button>
          <Button loading={busy} disabled={chosen === current} onClick={() => void confirm()}>
            {t('runs.header.changeProviderConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
