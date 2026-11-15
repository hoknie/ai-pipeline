import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { RepositoryPicker } from '../../repositories/index.ts';
import type { MultiProjects } from './ProjectsFields.tsx';

function moved(list: readonly string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Up, down and remove of a card. */
function CardButtons({
  index,
  label,
  multi,
}: {
  index: number;
  label: string;
  multi: MultiProjects;
}) {
  const { t } = useTranslation();
  const { projects, choose } = multi;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('queue.multi.moveUp', { project: label })}
        disabled={index === 0}
        onClick={() => choose(moved(projects, index, index - 1))}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('queue.multi.moveDown', { project: label })}
        disabled={index === projects.length - 1}
        onClick={() => choose(moved(projects, index, index + 1))}
      >
        <ArrowDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('queue.multi.remove', { project: label })}
        disabled={projects.length <= 1}
        onClick={() => choose(projects.filter((_, at) => at !== index))}
      >
        <X />
      </Button>
    </>
  );
}

/** One chosen project: its place in the order, its controls and its own addition to the text. */
function ProjectCard({
  idPrefix,
  index,
  multi,
  waitsFor,
  onDragStart,
  onDrop,
}: {
  idPrefix: string;
  /** The text over the card: it waits for the card above. */
  waitsFor?: string;
  index: number;
  multi: MultiProjects;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const { t } = useTranslation();
  const { projects } = multi;
  const path = projects[index]!;
  const label = repositoryLabel(path);
  return (
    <li
      className="flex min-w-0 list-none flex-col gap-1"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {waitsFor ? <p className="px-2 text-xs text-muted-foreground">{waitsFor}</p> : null}
      <div className="flex min-w-0 flex-col gap-2 rounded-md border bg-card p-2 text-sm">
        <div
          draggable
          title={t('queue.multi.drag', { project: label })}
          className="flex items-center gap-2"
          onDragStart={onDragStart}
        >
          <GripVertical aria-hidden className="size-4 text-muted-foreground" />
          <span className="w-4 text-right tabular-nums text-muted-foreground">{index + 1}</span>
          <ProjectDot path={path} />
          <span className="flex-1 truncate" title={path}>
            {label}
          </span>
          <CardButtons index={index} label={label} multi={multi} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-note-${index}`}>
            {t('queue.multi.note', { project: label })}
          </Label>
          <Input
            id={`${idPrefix}-note-${index}`}
            value={multi.notes[path] ?? ''}
            placeholder={t('queue.multi.notePlaceholder')}
            onChange={(event) => multi.setNote(path, event.target.value)}
          />
        </div>
      </div>
    </li>
  );
}

/** The ordered cards; the order changes by dragging or by the arrows. */
function ProjectList({ idPrefix, multi }: { idPrefix: string; multi: MultiProjects }) {
  const { t } = useTranslation();
  const [dragged, setDragged] = useState<number | null>(null);
  const { projects, choose, chain } = multi;
  return (
    <ol aria-label={t('queue.multi.order')} className="flex flex-col gap-1">
      {projects.map((path, index) => (
        <ProjectCard
          key={path}
          idPrefix={idPrefix}
          index={index}
          multi={multi}
          waitsFor={
            chain && index > 0
              ? t('queue.multi.waitsFor', {
                  next: repositoryLabel(path),
                  previous: repositoryLabel(projects[index - 1]!),
                })
              : undefined
          }
          onDragStart={() => setDragged(index)}
          onDrop={() => {
            if (dragged !== null) choose(moved(projects, dragged, index));
            setDragged(null);
          }}
        />
      ))}
    </ol>
  );
}

/** The half of the form about projects: the count, the order, the cards and the chain. */
export function ProjectsPanel({
  idPrefix,
  repositories,
  waiting,
  multi,
}: {
  idPrefix: string;
  repositories: readonly string[];
  waiting: ReadonlyMap<string, number>;
  multi: MultiProjects;
}) {
  const { t } = useTranslation();
  const rest = repositories.filter((path) => !multi.projects.includes(path));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm font-medium">
        {multi.projects.length < 2
          ? t('queue.multi.needMore')
          : t('queue.multi.summary', { count: multi.projects.length })}
      </p>
      {multi.noCommon ? <Alert variant="destructive">{t('queue.multi.noCommon')}</Alert> : null}
      <div className="flex items-center gap-2">
        <Switch id={`${idPrefix}-chain`} checked={multi.chain} onCheckedChange={multi.setChain} />
        <Label htmlFor={`${idPrefix}-chain`}>{t('queue.multi.chain')}</Label>
        <span className="text-xs text-muted-foreground">{t('queue.multi.chainHint')}</span>
      </div>
      <ProjectList idPrefix={idPrefix} multi={multi} />
      {rest.length > 0 ? (
        <RepositoryPicker
          id={`${idPrefix}-add-project`}
          label={t('queue.multi.add')}
          placeholder={t('queue.multi.addPlaceholder')}
          repositories={rest}
          value=""
          waiting={waiting}
          onChange={(path) => multi.choose([...multi.projects, path])}
        />
      ) : null}
    </div>
  );
}
