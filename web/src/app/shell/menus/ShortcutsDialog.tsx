import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { comboKeys } from '../../../shared/lib/browser/hotkeys.ts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { Kbd } from '../../../shared/ui/feedback/kbd.tsx';
import { SHORTCUTS, SHORTCUT_GROUPS } from '../../shortcuts.ts';

/** Reference of the keyboard shortcuts, opened with `?`. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} aria-label={t(`shortcuts.groups.${group}`)}>
            <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              {t(`shortcuts.groups.${group}`)}
            </h3>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.combo} className="contents">
                  <dt className="flex items-center gap-1">
                    {comboKeys(shortcut.combo).map((key, index) => (
                      <Fragment key={key}>
                        {index > 0 && shortcut.combo.includes(' ') ? (
                          <span className="text-xs text-muted-foreground">
                            {t('shortcuts.then')}
                          </span>
                        ) : null}
                        <Kbd>{key}</Kbd>
                      </Fragment>
                    ))}
                  </dt>
                  <dd>{t(shortcut.label)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
