import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { PathInput, type BrowseDirectories } from '../../repositories/index.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';

/**
 * «Change path…»: the new path of a project, starting from the current one (`~` for the home
 * directory); a refusal of the daemon stays in the dialog.
 */
export function MoveDialog({
  open,
  current,
  browse,
  onOpenChange,
  onMove,
}: {
  open: boolean;
  /** The current path as shown, the home directory as `~`. */
  current: string;
  browse: BrowseDirectories;
  onOpenChange: (open: boolean) => void;
  onMove: (to: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState(current);
  useEffect(() => {
    if (open) setPath(current);
  }, [open, current]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || path.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await onMove(path.trim());
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>{t('projects.move.title')}</DialogTitle>
            <DialogDescription>{t('projects.move.description')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="project-move-path">{t('projects.move.path')}</Label>
          <PathInput
            id="project-move-path"
            value={path}
            onChange={setPath}
            browse={browse}
            autoFocus
            invalid={error !== null}
            describedBy={error ? 'project-move-error' : undefined}
          />
          {error ? (
            <p id="project-move-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || path.trim() === '' || path.trim() === current}>
              {t('projects.move.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
