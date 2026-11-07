import { useTranslation } from 'react-i18next';

import { modLabel } from '../../../shared/lib/browser/hotkeys.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { SECTIONS } from '../../sections.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Kbd } from '../../../shared/ui/feedback/kbd.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/feedback/tooltip.tsx';

import { TopNavActions, TopNavSection } from './TopNavParts.tsx';
import type { NavProps } from './NavSidebar.tsx';
import { RepositoryMenu } from '../menus/RepositoryMenu.tsx';

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
        {SECTIONS.map(({ view: target, labelKey, icon }) => (
          <TopNavSection
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
      <TopNavActions
        onNewTask={onNewTask}
        onPalette={onPalette}
        notifications={notifications}
        showRepository={repository.repositories.length > 1}
      />
    </header>
  );
}
