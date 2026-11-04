import { Plus, Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { modLabel } from '../../hotkeys.ts';
import { cn } from '../../lib/cn.ts';
import { SECTIONS } from '../../sections.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import { Kbd } from '../../ui/kbd.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.tsx';

import { LanguageMenu } from './LanguageMenu.tsx';
import { NavCounter } from './NavCounter.tsx';
import { NotificationCenter } from './NotificationCenter.tsx';
import type { NavProps } from './NavSidebar.tsx';
import { RepositoryMenu } from './RepositoryMenu.tsx';
import { ThemeMenu } from './ThemeMenu.tsx';

/** A button or link shown as an icon gets its name in a tooltip. */
function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The navigation strip over the content: name and repository on the left, sections in the middle,
 * new task, search, notifications, language, theme and the link state on the right. Below 1024 px sections
 * and search show icons only.
 */
export function TopNav({
  view,
  hrefFor,
  onNavigate,
  working,
  waiting,
  queued,
  onPalette,
  onNewTask,
  notifications,
  repository,
}: NavProps) {
  const { t } = useTranslation();
  const counter = (target: string): number =>
    target === 'runs' ? working : target === 'queue' ? queued : 0;
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        <a
          href="#runs"
          className="flex shrink-0 items-center gap-1.5 text-sm font-semibold"
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
        <RepositoryMenu choice={repository} compact />
      </div>
      <nav aria-label={t('nav.sections')} className="flex shrink-0 items-center gap-1">
        {SECTIONS.map(({ view: target, labelKey, icon: Icon }) => {
          const label = t(`nav.${labelKey}`);
          const count = counter(target);
          const active = target === view;
          return (
            <Tip key={target} label={label}>
              <a
                href={hrefFor(target)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0',
                  active && 'bg-accent text-accent-foreground',
                )}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(target);
                }}
              >
                <span data-nav-icon className="relative flex size-4 items-center justify-center">
                  <Icon aria-hidden />
                  {count > 0 ? (
                    <NavCounter
                      target={target}
                      count={count}
                      waiting={waiting}
                      corner
                      className="lg:hidden"
                    />
                  ) : null}
                </span>
                <span className="sr-only lg:not-sr-only">{label}</span>
                {count > 0 ? (
                  <NavCounter
                    target={target}
                    count={count}
                    waiting={waiting}
                    className="hidden lg:inline-flex"
                  />
                ) : null}
                {target === 'runs' && waiting > 0 ? (
                  <Badge
                    variant="warn"
                    className="hidden lg:inline-flex"
                    aria-label={t('nav.waiting', { count: waiting })}
                  >
                    {waiting}
                  </Badge>
                ) : null}
              </a>
            </Tip>
          );
        })}
      </nav>
      <div className="flex min-w-0 items-center justify-end gap-1">
        <Tip label={t('nav.newTask')}>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 text-muted-foreground"
            onClick={onNewTask}
            disabled={!onNewTask}
            aria-label={t('nav.newTask')}
          >
            <Plus />
          </Button>
        </Tip>
        <Tip label={t('nav.search')}>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-muted-foreground [&_svg]:size-4"
            onClick={onPalette}
            aria-label={t('nav.palette')}
          >
            <Search />
            <span className="hidden lg:inline">{t('nav.search')}</span>
            <Kbd className="hidden lg:inline-flex">{modLabel()}K</Kbd>
          </Button>
        </Tip>
        <NotificationCenter
          state={notifications}
          compact
          showRepository={repository.repositories.length > 1}
        />
        <LanguageMenu compact />
        <ThemeMenu compact />
      </div>
    </header>
  );
}
