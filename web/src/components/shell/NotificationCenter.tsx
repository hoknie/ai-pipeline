import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import type { NotificationCenterState } from '../../notifications.ts';
import { repositoryLabel } from '../../repositories.ts';
import { statusInfo } from '../../status.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.tsx';

import { navRowClass } from './navRow.ts';

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

  const counter =
    unread > 0 ? (
      <Badge
        variant={unreadTone}
        aria-hidden
        data-notification-count
        className="absolute -right-2 -top-2 min-w-4 justify-center px-1 py-0 text-[10px] leading-4"
      >
        {unread > 99 ? '99+' : unread}
      </Badge>
    ) : null;
  const icon = (
    <span className="relative flex size-4 items-center justify-center">
      <Bell aria-hidden />
      {counter}
    </span>
  );

  const trigger = compact ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={label}>
            {icon}
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  ) : (
    <PopoverTrigger asChild>
      <Button variant="ghost" data-nav-row className={navRowClass()} aria-label={label}>
        {icon}
        <span>{t('nav.notifications')}</span>
      </Button>
    </PopoverTrigger>
  );

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
            {items.map((item) => {
              const info = statusInfo(item.kind, t);
              return (
                <li
                  key={item.key}
                  className="flex items-start gap-1 border-b last:border-b-0 hover:bg-accent/50"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2 text-left text-sm"
                    onClick={() => {
                      setOpen(false);
                      state.select(item);
                    }}
                  >
                    <span className="flex max-w-full items-center gap-2">
                      <Badge variant={info.tone}>{info.label}</Badge>
                      <span
                        className={cn(
                          'truncate',
                          state.isRead(item) ? 'font-normal' : 'font-semibold',
                        )}
                      >
                        {item.groupTitle}
                      </span>
                    </span>
                    <span className="max-w-full truncate text-xs text-muted-foreground">
                      {item.runTitle}
                      {showRepository ? ` · ${repositoryLabel(item.repository)}` : ''}
                    </span>
                    {item.detail ? (
                      <span className="max-w-full truncate text-xs">{item.detail}</span>
                    ) : null}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 shrink-0"
                    aria-label={t('notifications.hideGroup', { group: item.groupTitle })}
                    onClick={() => state.hide(item.key)}
                  >
                    {t('notifications.hide')}
                  </Button>
                </li>
              );
            })}
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
