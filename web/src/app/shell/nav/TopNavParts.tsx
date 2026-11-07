import { Plus, Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { modLabel } from '../../../shared/lib/browser/hotkeys.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import type { SECTIONS } from '../../sections.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Kbd } from '../../../shared/ui/feedback/kbd.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';

import { LanguageMenu } from '../menus/LanguageMenu.tsx';
import { NavCounter } from './NavCounter.tsx';
import { NotificationCenter } from '../menus/NotificationCenter.tsx';
import type { NavProps } from './NavSidebar.tsx';
import { ThemeMenu } from '../menus/ThemeMenu.tsx';
import type { View } from '../../../shared/lib/nav/route.ts';

/** A button or link shown as an icon gets its name in a tooltip. */
function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function TopNavSection(props: {
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
  const { target, label, count, active, waiting, onNavigate, icon: Icon } = props;
  return (
    <Tip key={target} label={label}>
      <a
        href={props.href}
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
}

export function TopNavActions({
  onNewTask,
  onPalette,
  notifications,
  showRepository,
}: {
  onNewTask: NavProps['onNewTask'];
  onPalette: () => void;
  notifications: NavProps['notifications'];
  showRepository: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      <Tip label={t('nav.newTask')}>
        <Button
          variant="outline"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
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
      <NotificationCenter state={notifications} compact showRepository={showRepository} />
      <LanguageMenu compact />
      <ThemeMenu compact />
    </div>
  );
}
