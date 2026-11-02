import { Bell, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { modLabel } from '../../hotkeys.ts';
import { cn } from '../../lib/cn.ts';
import type { View } from '../../route.ts';
import { SECTIONS } from '../../sections.ts';
import type { Connection } from '../../store.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import { Kbd } from '../../ui/kbd.tsx';

import { RepositoryMenu, type RepositoryChoice } from './RepositoryMenu.tsx';
import { ConnectionIndicator } from './ConnectionIndicator.tsx';
import { NavCounter } from './NavCounter.tsx';
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
}

/** Navigation of the sliding panel of a narrow window: sections with counters, palette, link state, theme. */
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
}: NavProps) {
  const { t } = useTranslation();
  const counter = (target: View): number =>
    target === 'runs' ? working : target === 'queue' ? queued : 0;
  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <a
        href="#runs"
        data-nav-row
        className={cn(navRowClass(), 'font-semibold')}
        onClick={(event) => {
          event.preventDefault();
          onNavigate('runs');
        }}
      >
        <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
          aip
        </span>
        <span>web</span>
      </a>
      <RepositoryMenu choice={repository} />
      <Button
        variant="outline"
        data-nav-row
        className={cn(navRowClass(), 'text-muted-foreground')}
        onClick={onPalette}
        aria-label={t('nav.palette')}
      >
        <Search />
        <span className="flex-1 text-left">{t('nav.search')}</span>
        <Kbd>{modLabel()}K</Kbd>
      </Button>
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
              className={cn(
                navRowClass(),
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
              </span>
              <span className="flex-1">{label}</span>
              {count > 0 ? <NavCounter target={target} count={count} waiting={waiting} /> : null}
              {target === 'runs' && waiting > 0 ? (
                <Badge variant="warn" aria-label={t('nav.waiting', { count: waiting })}>
                  {waiting}
                </Badge>
              ) : null}
            </a>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        {onEnableNotifications ? (
          <Button
            variant="ghost"
            data-nav-row
            className={navRowClass()}
            onClick={onEnableNotifications}
            aria-label={t('nav.notifications')}
          >
            <Bell />
            <span>{t('nav.notifications')}</span>
          </Button>
        ) : null}
        <ThemeMenu />
        <LanguageMenu />
        <ConnectionIndicator connection={connection} />
      </div>
    </div>
  );
}
