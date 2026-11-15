import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../shared/ui/forms/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../shared/ui/overlays/dialog.tsx';
import { RepositoryPicker } from './RepositoryPicker.tsx';

/** Asks for the project a new entry is created in, while the mode «All projects» is on. */
export function ChooseProjectDialog({
  open,
  onOpenChange,
  repositories,
  initial,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Paths of the enabled projects, in display order. */
  repositories: readonly string[];
  /** The project chosen at first: the last one of the panel. */
  initial: string | null;
  onChoose: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? initial ?? repositories[0] ?? '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projectChoice.title')}</DialogTitle>
          <DialogDescription>{t('projectChoice.description')}</DialogDescription>
        </DialogHeader>
        <RepositoryPicker
          label={t('projectChoice.label')}
          repositories={repositories}
          value={value}
          waiting={new Map()}
          onChange={setPicked}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={value === ''}
            onClick={() => {
              onChoose(value);
              onOpenChange(false);
              setPicked(null);
            }}
          >
            {t('projectChoice.choose')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
