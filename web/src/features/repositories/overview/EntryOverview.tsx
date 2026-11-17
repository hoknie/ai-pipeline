import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntryLevel } from '../../../shared/api/types.ts';
import type { Grouped } from '../../../shared/lib/catalog/projectRows.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { ReadOnlyHint } from './ReadOnlyHint.tsx';
import { useLevelLabel } from './ProjectChips.tsx';

/**
 * The entry of the mode «All projects», read only: the shared level and a block for every
 * project that has it, with a button that opens the entry in the project.
 */
export function EntryOverview<T extends { level: EntryLevel }>({
  title,
  id,
  row,
  describe,
  highlight,
  onOpen,
}: {
  title: string;
  id: string;
  row: Grouped<T>;
  /** A short description of the entry of a level of a project. */
  describe: (entry: T) => ReactNode;
  /** Slug of the project whose block is marked (the old `?project=` of an address). */
  highlight?: string | null | undefined;
  /** Opens the entry in the form of the project (leaves the mode). */
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const levelLabel = useLevelLabel();
  const marked = useRef<HTMLElement | null>(null);
  useEffect(() => {
    marked.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight, id]);
  return (
    <section aria-label={title} data-entry-overview={id} className="flex flex-col gap-3 px-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{id}</p>
        <ReadOnlyHint />
      </header>
      {row.shared ? (
        <div data-overview-shared className="rounded-md border p-3">
          <h3 className="text-sm font-medium">{t('projectOverview.shared')}</h3>
          <div className="text-sm text-muted-foreground">{describe(row)}</div>
        </div>
      ) : null}
      {row.presences.map(({ project, entry }) => {
        const level = levelLabel(entry.level);
        const on = highlight === project.slug;
        return (
          <div
            key={project.path}
            ref={(node) => {
              if (on) marked.current = node;
            }}
            data-overview-project={project.slug}
            data-highlighted={on ? 'true' : undefined}
            className={cn('flex flex-col gap-2 rounded-md border p-3', on && 'ring-2 ring-primary')}
          >
            <div className="flex items-center gap-2">
              <ProjectDot color={project.color} />
              <h3 className="text-sm font-medium">{project.label}</h3>
              {level ? <span className="text-xs text-muted-foreground">{level}</span> : null}
            </div>
            <div className="text-sm text-muted-foreground">{describe(entry)}</div>
            <div>
              <Button variant="outline" size="sm" onClick={() => onOpen(project.path)}>
                {t('projectOverview.open')}
                <span className="sr-only"> {project.label}</span>
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
