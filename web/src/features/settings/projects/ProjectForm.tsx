import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { RepositoryView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { MoveDialog } from './MoveDialog.tsx';
import { ProjectFacts, ProjectLinks } from './ProjectFacts.tsx';
import { Field, ProjectFields } from './ProjectFields.tsx';
import { placeholderName } from './projectDraft.ts';
import { useProjectForm } from './useProjectForm.ts';

export interface ProjectActions {
  api: Api;
  onRegistry: (registry: RepositoryView[]) => void;
  /** The project took another slug: the address follows it. */
  onSlug: (slug: string) => void;
  /** The project moved: the panel's chosen repository follows it. */
  onMoved: (from: string, to: string) => void;
  /** Asks and removes the project; true when it is gone. */
  onRemove: (path: string) => Promise<boolean>;
  /** Makes the project the panel's repository and opens its settings or its queue. */
  onOpen: (path: string, target: 'settings' | 'queue') => void;
  dirty: RefObject<boolean>;
}

/** The form of a project: its attributes, what it holds, its links and the removal. */
export function ProjectForm({
  project,
  actions,
}: {
  project: RepositoryView;
  actions: ProjectActions;
}) {
  const { t } = useTranslation();
  const { draft, setDraft, errors, failure, busy, changed, save, discard, move } = useProjectForm(
    project,
    actions,
  );
  const [moving, setMoving] = useState(false);

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      aria-label={t('projects.form', { name: project.label })}
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && !busy) void save();
      }}
    >
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      <ProjectFields
        draft={draft}
        onDraft={setDraft}
        errors={errors}
        namePlaceholder={placeholderName(project)}
        withEnabled
      />
      <Field id="project-path" label={t('projects.fields.path')} hint={t('projects.hints.path')}>
        <div className="flex min-w-0 items-center gap-2">
          <code id="project-path" className="min-w-0 flex-1 truncate text-sm" title={project.path}>
            {project.path}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => setMoving(true)}>
            {t('projects.move.open')}
          </Button>
        </div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!changed || busy}>
          {t('settingsPage.save')}
        </Button>
        <Button type="button" variant="outline" disabled={!changed || busy} onClick={discard}>
          {t('settingsPage.discard')}
        </Button>
      </div>
      <ProjectFacts project={project} />
      <ProjectLinks project={project} actions={actions} />
      <MoveDialog
        open={moving}
        current={project.displayPath}
        browse={actions.api.directories}
        onOpenChange={setMoving}
        onMove={move}
      />
    </form>
  );
}
