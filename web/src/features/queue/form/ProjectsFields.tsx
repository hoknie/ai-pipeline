import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { RepositoryPicker } from '../../repositories/index.ts';
import { ProjectsPanel } from './ProjectCards.tsx';

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

/** The button of the header: the task goes to one project or to several. */
export function MultiProjectsToggle({ multi }: { multi: MultiProjects }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant={multi.on ? 'secondary' : 'outline'}
      size="sm"
      aria-pressed={multi.on}
      onClick={() => multi.toggle(!multi.on)}
    >
      <Layers aria-hidden />
      <span className="max-sm:sr-only">{t('queue.multi.toggle')}</span>
    </Button>
  );
}

/** The shared tag of a task in several projects, under its text. */
function SharedTagField({ idPrefix, multi }: { idPrefix: string; multi: MultiProjects }) {
  const { t } = useTranslation();
  return (
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
  repositoryLabel: string;
}) {
  const { multi } = input;
  return {
    repositoryField: multi.on ? undefined : (
      <RepositoryPicker
        id="new-repository"
        label={input.repositoryLabel}
        repositories={input.repositories}
        value={input.target}
        waiting={input.waiting}
        onChange={input.onTarget}
      />
    ),
    several: multi.on,
    providerRepositories: multi.on ? multi.projects : undefined,
    extras: multi.on ? <SharedTagField idPrefix="new" multi={multi} /> : undefined,
    projectsPanel: multi.on ? (
      <ProjectsPanel
        idPrefix="new"
        repositories={input.repositories}
        waiting={input.waiting}
        multi={multi}
      />
    ) : undefined,
    blockedHint: multi.on && multi.projects.length < 2 ? input.needMore : undefined,
  };
}
