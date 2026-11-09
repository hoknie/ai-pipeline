import { useEffect, useState } from 'react';

import type { RepositoryView } from '../../../shared/api/types.ts';
import type { ProjectActions } from './ProjectForm.tsx';
import type { FieldErrors } from './ProjectFields.tsx';
import { changesOf, draftOf, fieldOfError, type ProjectDraft } from './projectDraft.ts';

/** The draft of a project, its saving with the refusals at their fields, and its move. */
export function useProjectForm(project: RepositoryView, actions: ProjectActions) {
  const { api, dirty } = actions;
  const [draft, setDraft] = useState<ProjectDraft>(() => draftOf(project));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changes = changesOf(project, draft);
  const changed = Object.keys(changes).length > 0;
  useEffect(() => {
    dirty.current = changed;
  }, [changed, dirty]);
  useEffect(() => () => void (dirty.current = false), [dirty]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    setFailure(null);
    try {
      const list = await api.updateRepository(project.path, changes);
      const saved = list.find((entry) => entry.path === project.path);
      if (saved) setDraft(draftOf(saved));
      dirty.current = false;
      actions.onRegistry(list);
      if (saved && saved.slug !== project.slug) actions.onSlug(saved.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const field = fieldOfError(message);
      if (field !== null && field !== 'path') setErrors({ [field]: message });
      else setFailure(message);
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setDraft(draftOf(project));
    setErrors({});
    setFailure(null);
  };
  const move = async (to: string) => {
    const list = await api.moveRepository(project.path, to);
    const moved = list.find((entry) => entry.slug === project.slug);
    actions.onRegistry(list);
    if (moved) actions.onMoved(project.path, moved.path);
  };
  return { draft, setDraft, errors, failure, busy, changed, save, discard, move };
}
