import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EntryLevel } from '../../../shared/api/types.ts';
import type { Grouped, ProjectRef } from '../../../shared/lib/catalog/projectRows.ts';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { ReadOnlyHint } from './ReadOnlyHint.tsx';
import { useLevelLabel } from './ProjectChips.tsx';

function ProjectRow({
  project,
  level,
  description,
  highlighted,
  chosen,
  marked,
  onPreview,
  onOpen,
}: {
  project: ProjectRef;
  level: EntryLevel;
  description: ReactNode;
  highlighted: boolean;
  chosen: boolean;
  marked: MutableRefObject<HTMLElement | null>;
  onPreview: ((slug: string) => void) | undefined;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  const label = useLevelLabel()(level);
  const content = (
    <>
      <ProjectDot color={project.color} />
      <span className="text-sm font-medium">{project.label}</span>
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      {description ? (
        <span className="min-w-0 truncate text-sm text-muted-foreground">{description}</span>
      ) : null}
    </>
  );
  return (
    <li
      ref={(node) => {
        if (highlighted) marked.current = node;
      }}
      data-overview-project={project.slug}
      data-highlighted={highlighted ? 'true' : undefined}
      data-active={chosen ? 'true' : undefined}
      aria-current={chosen ? 'true' : undefined}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5',
        highlighted && 'ring-2 ring-inset ring-primary',
        chosen && 'bg-muted',
      )}
    >
      {onPreview ? (
        <button
          type="button"
          onClick={() => onPreview(project.slug)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{content}</div>
      )}
      <Button variant="ghost" size="sm" onClick={() => onOpen(project.path)}>
        {t('projectOverview.open')}
        <span className="sr-only"> {project.label}</span>
      </Button>
    </li>
  );
}

/**
 * The entry of the mode «All projects», read only: a compact list of the projects that have it,
 * a row per project with a button that opens the entry in the project, and a preview below.
 */
export function EntryOverview<T extends { level: EntryLevel }>({
  title,
  id,
  row,
  describe,
  highlight,
  active,
  onPreview,
  preview,
  onOpen,
}: {
  title: string;
  id: string;
  row: Grouped<T>;
  /** A short description of the entry of a project, one muted line in its row. */
  describe?: ((entry: T) => ReactNode) | undefined;
  /** Slug of the project whose row is marked (the old `?project=` of an address). */
  highlight?: string | null | undefined;
  /** Slug of the project the preview shows. */
  active?: string | null | undefined;
  /** Chooses the project of the preview (a click on its row, not on the button). */
  onPreview?: ((slug: string) => void) | undefined;
  /** What is shown under the list: the preview of the configuration. */
  preview?: ReactNode;
  /** Opens the entry in the form of the project (leaves the mode). */
  onOpen: (path: string) => void;
}) {
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
      <ul className="flex flex-col divide-y rounded-md border">
        {row.presences.map(({ project, entry }) => (
          <ProjectRow
            key={project.path}
            project={project}
            level={entry.level}
            description={describe?.(entry)}
            highlighted={highlight === project.slug}
            chosen={active === project.slug}
            marked={marked}
            onPreview={onPreview}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {preview}
    </section>
  );
}
