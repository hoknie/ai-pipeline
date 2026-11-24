import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../../shared/api/api.ts';
import type { ProviderView, RunView } from '../../../../shared/api/types.ts';
import { ProviderPicker } from '../../../providers/index.ts';
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

/** Picks another provider of the run for an unfinished run (or none) and asks the daemon to switch. */
export function RunProviderDialog({
  run,
  api,
  providers,
  onClose,
}: {
  run: RunView;
  api: Api;
  providers: ProviderView[];
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
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('runs.header.changeProviderTitle')}</DialogTitle>
          <DialogDescription>{t('runs.header.changeProviderDescription')}</DialogDescription>
        </DialogHeader>
        <ProviderPicker
          label={t('runs.header.changeProviderTitle')}
          value={chosen}
          onChange={setChosen}
          providers={providers}
          emptyLabel={t('runs.header.providerNone')}
          current={current}
          repository={run.repository}
          api={api}
          disabled={busy}
        />
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
