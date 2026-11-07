import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NotificationCenterState } from '../../notifications.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { BellTrigger, NotificationRow } from './NotificationRows.tsx';
import { Popover, PopoverContent } from '../../../shared/ui/overlays/popover.tsx';

/**
 * The bell of the navigation and the list it opens: groups waiting for a person, the unread
 * counter on the bell and the state of the browser permission. `compact` is the icon of the top
 * strip; otherwise it is a row of the navigation panel.
 */
export function NotificationCenter({
  state,
  compact = false,
  showRepository,
}: {
  state: NotificationCenterState;
  compact?: boolean;
  /** Names the repository of an item: more than one repository is known. */
  showRepository: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { items, unread, unreadTone, permission } = state;
  const label = unread > 0 ? t('notifications.unread', { count: unread }) : t('nav.notifications');

  // Items that arrive while the list is open are seen at once.
  const markRead = state.open;
  useEffect(() => {
    if (open && unread > 0) markRead();
  }, [open, unread, markRead]);

  const trigger = <BellTrigger compact={compact} label={label} unread={unread} tone={unreadTone} />;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) state.open();
      }}
    >
      {trigger}
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
          {items.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={state.hideAll}>
              {t('notifications.hideAll')}
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('notifications.empty')}
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((item) => (
              <NotificationRow
                key={item.key}
                item={item}
                state={state}
                showRepository={showRepository}
                onSelect={() => {
                  setOpen(false);
                  state.select(item);
                }}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-col items-start gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <p role="status">{t(`notifications.${permission}`)}</p>
          {permission === 'default' ? (
            <Button variant="outline" size="sm" onClick={state.enable}>
              {t('notifications.enable')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
