import type { ReactElement } from 'react';
import { Bell, ChevronsLeft, ChevronsRight, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { modLabel } from '../../hotkeys.ts';
import { cn } from '../../lib/cn.ts';
import type { View } from '../../route.ts';
import { SECTIONS } from '../../sections.ts';
import type { Connection } from '../../store.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import { Kbd } from '../../ui/kbd.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.tsx';

import { RepositoryMenu, type RepositoryChoice } from './RepositoryMenu.tsx';
import { ConnectionIndicator } from './ConnectionIndicator.tsx';
import { navRowClass } from './navRow.ts';
import { LanguageMenu } from './LanguageMenu.tsx';
import { ThemeMenu } from './ThemeMenu.tsx';

export interface NavProps {
  view: View;
  hrefFor: (view: View) => string;
  onNavigate: (view: View) => void;
  /** Runs in progress (active or waiting for an answer). */
  working: number;
  /** Runs waiting for an answer. */
  waiting: number;
  /** Tasks in the queue. */
  queued: number;
  connection: Connection;
  onPalette: () => void;
  /** Offers browser notifications; null when they are on or unsupported. */
  onEnableNotifications: (() => void) | null;
  /** The repository selector. */
  repository: RepositoryChoice;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/** In the collapsed column a button has no text, so its name goes to a tooltip. */
function withTip(collapsed: boolean, label: string, button: ReactElement): ReactElement {
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Navigation of the panel: sections with counters, palette, link state, theme. */
export function NavSidebar({
  view,
  hrefFor,
  onNavigate,
  working,
  waiting,
  queued,
  connection,
  onPalette,
  onEnableNotifications,
  repository,
  collapsed = false,
  onToggleCollapsed,
}: NavProps) {
  const { t } = useTranslation();
  const counter = (target: View): number =>
    target === 'runs' ? working : target === 'queue' ? queued : 0;
  const badge = (target: View, count: number, corner: boolean) => (
    <Badge
      variant={target === 'runs' ? (waiting > 0 ? 'warn' : 'run') : 'mute'}
      aria-label={
        target === 'runs'
          ? waiting > 0
            ? t('nav.workingWaiting', { count, waiting })
            : t('nav.working', { count })
          : t('nav.queued', { count })
      }
      className={
        corner
          ? 'absolute -right-2 -top-2 min-w-4 justify-center px-1 py-0 text-[10px] leading-4'
          : undefined
      }
    >
      {corner && count > 99 ? '99+' : count}
    </Badge>
  );
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <a
        href="#runs"
        data-nav-row
        className={cn(navRowClass(collapsed), 'font-semibold')}
        onClick={(event) => {
          event.preventDefault();
          onNavigate('runs');
        }}
      >
        <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
          aip
        </span>
        {collapsed ? null : <span>web</span>}
      </a>
      <RepositoryMenu choice={repository} collapsed={collapsed} />
      {withTip(
        collapsed,
        t('nav.search'),
        <Button
          variant="outline"
          data-nav-row
          className={cn(navRowClass(collapsed), 'text-muted-foreground')}
          onClick={onPalette}
          aria-label={t('nav.palette')}
        >
          <Search />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">{t('nav.search')}</span>
              <Kbd>{modLabel()}K</Kbd>
            </>
          )}
        </Button>,
      )}
      <nav aria-label={t('nav.sections')} className="flex flex-col gap-0.5">
        {SECTIONS.map(({ view: target, labelKey, icon: Icon }) => {
          const label = t(`nav.${labelKey}`);
          const count = counter(target);
          const active = target === view;
          return (
            <a
              key={target}
              href={hrefFor(target)}
              data-nav-row
              aria-current={active ? 'page' : undefined}
              title={collapsed ? label : undefined}
              className={cn(
                navRowClass(collapsed),
                'relative font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                active && 'bg-accent text-accent-foreground',
              )}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(target);
              }}
            >
              <span data-nav-icon className="relative flex size-4 items-center justify-center">
                <Icon aria-hidden />
                {collapsed && count > 0 ? badge(target, count, true) : null}
              </span>
              {collapsed ? (
                <span className="sr-only">{label}</span>
              ) : (
                <span className="flex-1">{label}</span>
              )}
              {!collapsed && count > 0 ? badge(target, count, false) : null}
              {!collapsed && target === 'runs' && waiting > 0 ? (
                <Badge variant="warn" aria-label={t('nav.waiting', { count: waiting })}>
                  {waiting}
                </Badge>
              ) : null}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        {onEnableNotifications
          ? withTip(
              collapsed,
              t('nav.notifications'),
              <Button
                variant="ghost"
                data-nav-row
                className={navRowClass(collapsed)}
                onClick={onEnableNotifications}
                aria-label={t('nav.notifications')}
              >
                <Bell />
                {collapsed ? null : <span>{t('nav.notifications')}</span>}
              </Button>,
            )
          : null}
        <ThemeMenu collapsed={collapsed} />
        <LanguageMenu collapsed={collapsed} />
        <ConnectionIndicator connection={connection} collapsed={collapsed} />
        {onToggleCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                data-nav-row
                className={navRowClass(collapsed)}
                aria-label={collapsed ? t('nav.expandNavigation') : t('nav.collapseNavigation')}
                aria-pressed={collapsed}
                onClick={onToggleCollapsed}
              >
                {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{collapsed ? t('nav.expand') : t('nav.collapse')}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
