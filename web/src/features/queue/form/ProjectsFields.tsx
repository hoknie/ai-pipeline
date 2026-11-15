import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { ProjectDot } from '../../../shared/ui/feedback/ProjectDot.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Checkbox } from '../../../shared/ui/forms/checkbox.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { RepositoryPicker } from '../../repositories/index.ts';

/** What the form shows and changes of a task in several projects; see `useNewTaskState`. */
export interface MultiProjects {
  on: boolean;
  /** Paths of the chosen projects in the order of the chain. */
  projects: string[];
  notes: Record<string, string>;
  /** The text of the shared tag: the one the user typed or the one the title gives. */
  sharedTag: string;
  chain: boolean;
  /** Every chosen project is loaded and none has a pipeline the others have too. */
  noCommon: boolean;
  toggle: (enabled: boolean) => void;
  choose: (projects: string[]) => void;
  setNote: (project: string, text: string) => void;
  setTag: (tag: string) => void;
  setChain: (chain: boolean) => void;
}

function moved(list: readonly string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** The chosen projects with their numbers; the order changes by dragging or by the arrows. */
function ChosenProjects({ multi }: { multi: MultiProjects }) {
  const { t } = useTranslation();
  const [dragged, setDragged] = useState<number | null>(null);
  const { projects, choose } = multi;
  return (
    <ol aria-label={t('queue.multi.order')} className="flex flex-col gap-1">
      {projects.map((path, index) => {
        const label = repositoryLabel(path);
        return (
          <li
            key={path}
            draggable
            title={t('queue.multi.drag', { project: label })}
            className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-sm"
            onDragStart={() => setDragged(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged !== null) choose(moved(projects, dragged, index));
              setDragged(null);
            }}
            onDragEnd={() => setDragged(null)}
          >
            <GripVertical aria-hidden className="size-4 text-muted-foreground" />
            <span className="w-4 text-right tabular-nums text-muted-foreground">{index + 1}</span>
            <ProjectDot path={path} />
            <span className="flex-1 truncate">{label}</span>
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
          </li>
        );
      })}
    </ol>
  );
}

function ProjectChoice({
  repositories,
  multi,
}: {
  repositories: readonly string[];
  multi: MultiProjects;
}) {
  const { t } = useTranslation();
  const { projects, choose } = multi;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 rounded-md border p-2">
      <legend className="px-1 text-xs text-muted-foreground">{t('queue.multi.projects')}</legend>
      <div className="flex max-h-40 flex-col gap-1 overflow-auto">
        {repositories.map((path) => (
          <label key={path} className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label={repositoryLabel(path)}
              checked={projects.includes(path)}
              onCheckedChange={(checked) =>
                choose(
                  checked === true
                    ? [...projects.filter((known) => known !== path), path]
                    : projects.filter((known) => known !== path),
                )
              }
            />
            <ProjectDot path={path} />
            <span className="truncate" title={path}>
              {repositoryLabel(path)}
            </span>
          </label>
        ))}
      </div>
      <ChosenProjects multi={multi} />
    </fieldset>
  );
}

/** The field of the repository: one project, or several with their order after the switch. */
export function ProjectsPicker(props: {
  idPrefix: string;
  repositories: readonly string[];
  waiting: ReadonlyMap<string, number>;
  /** The project of a single task. */
  target: string;
  onTarget: (target: string) => void;
  multi: MultiProjects;
}) {
  const { t } = useTranslation();
  const { idPrefix, multi } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Switch id={`${idPrefix}-multi`} checked={multi.on} onCheckedChange={multi.toggle} />
        <Label htmlFor={`${idPrefix}-multi`}>{t('queue.multi.toggle')}</Label>
      </div>
      {multi.on ? (
        <ProjectChoice repositories={props.repositories} multi={multi} />
      ) : (
        <RepositoryPicker
          id={`${idPrefix}-repository`}
          label={t('queue.form.repository')}
          repositories={props.repositories}
          value={props.target}
          waiting={props.waiting}
          onChange={props.onTarget}
        />
      )}
    </div>
  );
}

/** Under the text of the task: an addition per project, the shared tag and the chain. */
export function ProjectsExtras({ idPrefix, multi }: { idPrefix: string; multi: MultiProjects }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {multi.noCommon ? <Alert variant="destructive">{t('queue.multi.noCommon')}</Alert> : null}
      {multi.projects.map((path, index) => {
        const label = repositoryLabel(path);
        return (
          <div key={path} className="flex min-w-0 flex-col gap-1.5">
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
        );
      })}
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-shared-tag`}>{t('queue.multi.tag')}</Label>
        <Input
          id={`${idPrefix}-shared-tag`}
          value={multi.sharedTag}
          maxLength={30}
          onChange={(event) => multi.setTag(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('queue.multi.tagHint')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Switch id={`${idPrefix}-chain`} checked={multi.chain} onCheckedChange={multi.setChain} />
        <Label htmlFor={`${idPrefix}-chain`}>{t('queue.multi.chain')}</Label>
        <span className="text-xs text-muted-foreground">{t('queue.multi.chainHint')}</span>
      </div>
    </div>
  );
}

/** The props of `QueueForm` for the repository field and the fields of several projects. */
export function projectsFormProps(input: {
  multi: MultiProjects;
  repositories: readonly string[];
  waiting: ReadonlyMap<string, number>;
  target: string;
  onTarget: (target: string) => void;
  needMore: string;
}) {
  const { multi } = input;
  return {
    repositoryField: (
      <ProjectsPicker
        idPrefix="new"
        repositories={input.repositories}
        waiting={input.waiting}
        target={input.target}
        onTarget={input.onTarget}
        multi={multi}
      />
    ),
    several: multi.on,
    extras: multi.on ? <ProjectsExtras idPrefix="new" multi={multi} /> : undefined,
    blockedHint: multi.on && multi.projects.length < 2 ? input.needMore : undefined,
  };
}
