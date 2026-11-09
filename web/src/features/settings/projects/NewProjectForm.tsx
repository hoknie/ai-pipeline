import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepositoryView } from '../../../shared/api/types.ts';
import { addedProject } from '../../../shared/lib/catalog/repositories.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { PathInput } from '../../repositories/index.ts';
import type { ProjectActions } from './ProjectForm.tsx';
import { Field, ProjectFields, type FieldErrors } from './ProjectFields.tsx';
import { fieldOfError, type ProjectDraft } from './projectDraft.ts';

const EMPTY_DRAFT: ProjectDraft = { name: '', slug: '', enabled: true, color: null };

/** The form of a new project: the path, and the name, slug and color it may start with. */
export function NewProjectForm({
  registry,
  actions,
}: {
  registry: RepositoryView[];
  actions: ProjectActions;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [draft, setDraft] = useState<ProjectDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      const list = await actions.api.addRepository(path.trim(), {
        ...(draft.name.trim() !== '' ? { name: draft.name.trim() } : {}),
        ...(draft.slug.trim() !== '' ? { slug: draft.slug.trim() } : {}),
        ...(draft.color !== null ? { color: draft.color } : {}),
      });
      actions.onRegistry(list);
      const added = addedProject(path.trim(), registry, list);
      if (added) actions.onSlug(added.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const field = fieldOfError(message);
      if (field !== null) setErrors({ [field]: message });
      else setFailure(message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      aria-label={t('projects.new')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && path.trim() !== '') void add();
      }}
    >
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      <Field
        id="project-new-path"
        label={t('projects.fields.path')}
        hint={t('projects.hints.newPath')}
        error={errors.path}
      >
        <PathInput
          id="project-new-path"
          value={path}
          required
          placeholder="~/projects/app"
          browse={actions.api.directories}
          invalid={errors.path !== undefined}
          onChange={setPath}
        />
      </Field>
      <ProjectFields
        draft={draft}
        onDraft={setDraft}
        errors={errors}
        namePlaceholder={t('projects.hints.nameAuto')}
        withEnabled={false}
      />
      <div>
        <Button type="submit" disabled={busy || path.trim() === ''}>
          {t('projects.add')}
        </Button>
      </div>
    </form>
  );
}
