import { useEffect, useMemo, useState } from 'react';

import type {
  ConfigEditorResponse,
  EditorSpecialist,
  EntryReference,
  FieldError,
  WriteLevel,
} from '../../../shared/api/types.ts';
import { draftOf, fieldOf, sameDraft, type Draft, type FieldName } from './draft.ts';
import type { SharedOnly } from './SpecialistUsage.tsx';

export interface EditorInput {
  view: ConfigEditorResponse;
  /** null for a new specialist. */
  specialist: EditorSpecialist | null;
  sharedOnly?: SharedOnly | undefined;
  onDirty: (dirty: boolean) => void;
}

/** The file of a level, or the one that applies when the level has none. */
export function levelView(specialist: EditorSpecialist | null, level: WriteLevel) {
  const sources = specialist?.sources ?? {};
  const source = sources[level];
  return {
    sources,
    source,
    bothLevels: Boolean(sources.project && sources.global),
    raw: source?.raw ?? specialist?.raw ?? {},
    revision: source?.revision ?? null,
  };
}

/** What the person is editing: the level, the draft, the slug of a new specialist. */
export function useEditorFields(specialist: EditorSpecialist | null, sharedOnly?: SharedOnly) {
  const [level, setLevel] = useState<WriteLevel>(
    sharedOnly || specialist?.level === 'global' ? 'global' : 'project',
  );
  const [draft, setDraft] = useState<Draft>(() => draftOf(levelView(specialist, level).raw));
  const [slug, setSlug] = useState(specialist?.slug ?? '');
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return { level, setLevel, draft, setDraft, slug, setSlug, saveAs, setSaveAs, busy, setBusy };
}

/** What the last write said. */
export function useEditorFeedback() {
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [references, setReferences] = useState<EntryReference[]>([]);
  const clear = () => {
    setErrors([]);
    setConflict(null);
  };
  return {
    errors,
    setErrors,
    problem,
    setProblem,
    conflict,
    setConflict,
    references,
    setReferences,
    clear,
  };
}

/** The values `defaults.*` a field falls back to. */
function defaultsOf(view: ConfigEditorResponse, shared: boolean): Record<string, unknown> {
  return Object.fromEntries(
    view.settings
      .filter((setting) => setting.path.startsWith('defaults.'))
      .map((s) => [s.path, shared ? s.globalValue : s.value]),
  );
}

/** What follows from the fields: the file of the level, the dirty flag, the errors by field. */
export function useEditorDerived(
  { view, specialist, sharedOnly, onDirty }: EditorInput,
  { level, draft, slug }: ReturnType<typeof useEditorFields>,
  { errors }: ReturnType<typeof useEditorFeedback>,
) {
  const file = levelView(specialist, level);
  const initial = useMemo(() => draftOf(file.raw), [file.raw]);
  // a shared (global) specialist is view only; the project override is how to change it
  const readOnly = Boolean(specialist) && level === 'global' && !sharedOnly;
  const dirty = !sameDraft(draft, initial) || (!specialist && slug !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const id = specialist?.slug ?? slug;
  const prefix = `swarm.specialists.${id}.`;
  return {
    ...file,
    readOnly,
    dirty,
    id,
    prefix,
    // the shared level is checked against the shared defaults, not against what a project makes of them
    defaults: defaultsOf(view, Boolean(sharedOnly)),
    fieldErrors: (field: FieldName) =>
      errors.filter((error) => fieldOf(error.path, prefix) === field),
    otherErrors: errors.filter((error) => fieldOf(error.path, prefix) === null),
  };
}
