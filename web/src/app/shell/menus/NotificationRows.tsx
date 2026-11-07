import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../shared/lib/browser/cn.ts';
import type { NotificationCenterState, NotificationItem } from '../../notifications.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { statusInfo } from '../../../shared/lib/status.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { PopoverTrigger } from '../../../shared/ui/overlays/popover.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';

import { navRowClass } from '../nav/navRow.ts';

/** The bell with the unread counter: an icon of the top strip, or a row of the navigation panel. */
export function BellTrigger({
  compact,
  label,
  unread,
  tone,
}: {
  compact: boolean;
  label: string;
  unread: number;
  tone: NotificationCenterState['unreadTone'];
}) {
  const { t } = useTranslation();
  const counter =
    unread > 0 ? (
      <Badge
        variant={tone}
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
  return trigger;
}

/** One group waiting for a person: opens it, or hides the notification. */
export function NotificationRow({
  item,
  state,
  showRepository,
  onSelect,
}: {
  item: NotificationItem;
  state: NotificationCenterState;
  showRepository: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const info = statusInfo(item.kind, t);
  return (
    <li
      key={item.key}
      className="flex items-start gap-1 border-b last:border-b-0 hover:bg-accent/50"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2 text-left text-sm"
        onClick={onSelect}
      >
        <span className="flex max-w-full items-center gap-2">
          <Badge variant={info.tone}>{info.label}</Badge>
          {item.humanOnly ? (
            <Badge variant="warn">{t(`runs.humanOnly.${item.humanOnly}`)}</Badge>
          ) : null}
          <span className={cn('truncate', state.isRead(item) ? 'font-normal' : 'font-semibold')}>
            {item.groupTitle}
          </span>
        </span>
        <span className="max-w-full truncate text-xs text-muted-foreground">
          {item.runTitle}
          {showRepository ? ` · ${repositoryLabel(item.repository)}` : ''}
        </span>
        {item.detail ? <span className="max-w-full truncate text-xs">{item.detail}</span> : null}
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
}
