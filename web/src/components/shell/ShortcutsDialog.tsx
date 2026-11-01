import { modLabel } from '../../hotkeys.ts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.tsx';
import { Kbd } from '../../ui/kbd.tsx';
import { useTranslation } from 'react-i18next';

/** Reference of the keyboard shortcuts, opened with `?`. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const shortcuts: [string, string][] = [
    [`${modLabel()}+K`, t('shortcuts.palette')],
    ['j', t('shortcuts.nextRun')],
    ['k', t('shortcuts.previousRun')],
    ['?', t('shortcuts.help')],
    ['Esc', t('shortcuts.close')],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {shortcuts.map(([keys, label]) => (
            <div key={keys} className="contents">
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
