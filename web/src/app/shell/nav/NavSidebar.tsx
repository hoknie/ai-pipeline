import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { modLabel } from '../../../shared/lib/browser/hotkeys.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import type { View } from '../../../shared/lib/nav/route.ts';
import { SECTIONS } from '../../sections.ts';
import type { NotificationCenterState } from '../../notifications.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Kbd } from '../../../shared/ui/feedback/kbd.tsx';

import { RepositoryMenu, type RepositoryChoice } from '../menus/RepositoryMenu.tsx';
import { NavCounter } from './NavCounter.tsx';
import { NotificationCenter } from '../menus/NotificationCenter.tsx';
import { navRowClass } from './navRow.ts';
import { LanguageMenu } from '../menus/LanguageMenu.tsx';
import { ThemeMenu } from '../menus/ThemeMenu.tsx';

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
  onPalette: () => void;
  /** Opens the new task dialog; absent while the queue is not loaded, then the button is disabled. */
  onNewTask?: () => void;
  /** The notification centre: the list, the unread counter and the browser permission. */
  notifications: NotificationCenterState;
  /** The repository selector. */
  repository: RepositoryChoice;
}

function SectionLink(props: {
  target: View;
  label: string;
  icon: (typeof SECTIONS)[number]['icon'];
  count: number;
  active: boolean;
  waiting: number;
  href: string;
  onNavigate: (view: View) => void;
}) {
  const { t } = useTranslation();
  const { target, active, count, waiting, icon: Icon } = props;
  return (
    <a
      href={props.href}
      data-nav-row
      aria-current={active ? 'page' : undefined}
      className={cn(
        navRowClass(),
        'relative font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent text-accent-foreground',
      )}
      onClick={(event) => {
        event.preventDefault();
        props.onNavigate(target);
      }}
    >
      <span data-nav-icon className="relative flex size-4 items-center justify-center">
        <Icon aria-hidden />
      </span>
      <span className="flex-1">{props.label}</span>
      {count > 0 ? <NavCounter target={target} count={count} waiting={waiting} /> : null}
      {target === 'runs' && waiting > 0 ? (
        <Badge variant="warn" aria-label={t('nav.waiting', { count: waiting })}>
          {waiting}
        </Badge>
      ) : null}
    </a>
  );
}

/** Navigation of the sliding panel of a narrow window: sections with counters, palette, link state, theme. */
export function NavSidebar({
  view,
  hrefFor,
  onNavigate,
  working,
  waiting,
  queued,
  onPalette,
  notifications,
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
        {SECTIONS.map(({ view: target, labelKey, icon }) => (
          <SectionLink
            key={target}
            target={target}
            label={t(`nav.${labelKey}`)}
            icon={icon}
            count={counter(target)}
            active={target === view}
            waiting={waiting}
            href={hrefFor(target)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <NotificationCenter
          state={notifications}
          showRepository={repository.repositories.length > 1}
        />
        <ThemeMenu />
        <LanguageMenu />
      </div>
    </div>
  );
}
