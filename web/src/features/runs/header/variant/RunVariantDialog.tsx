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
import type { RunVariant } from './useRunVariants.ts';

/** Picks another variant of the pipeline for an unfinished run and asks the daemon to switch. */
export function RunVariantDialog({
  run,
  api,
  variants,
  onClose,
}: {
  run: RunView;
  api: Api;
  variants: RunVariant[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(run.variant);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setRunVariant(run.id, chosen);
      notifySuccess(t('runs.header.variantChanged'));
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
          <DialogTitle>{t('runs.header.changeVariantTitle')}</DialogTitle>
          <DialogDescription>{t('runs.header.changeVariantDescription')}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" className="flex flex-col gap-2">
          {variants.map((variant) => (
            <label key={variant.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="run-variant"
                value={variant.id}
                checked={chosen === variant.id}
                disabled={busy}
                onChange={() => setChosen(variant.id)}
              />
              {variant.name}
              {variant.name !== variant.id ? (
                <span className="font-mono text-xs text-muted-foreground">{variant.id}</span>
              ) : null}
            </label>
          ))}
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('runs.header.changeVariantKeep')}
          </Button>
          <Button loading={busy} disabled={chosen === run.variant} onClick={() => void confirm()}>
            {t('runs.header.changeVariantConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
