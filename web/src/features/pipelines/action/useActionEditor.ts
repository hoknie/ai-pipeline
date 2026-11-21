import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, FieldError, WriteLevel } from '../../../shared/api/types.ts';
import type { ActionEntry, ActionReference } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { specialistOptions, type SpecialistOption } from '../../../shared/lib/specialistLabels.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import {
  draftOfAction,
  fieldOf,
  valueOfAction,
  type ActionDraft,
  type Field,
} from './actionDraft.ts';

export interface ActionEditorInput {
  api: Api;
  view: ConfigEditorResponse;
  /** null for a new action. */
  action: ActionEntry | null;
  onDirty: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

/** What the person is editing, and what the last write said. */
function useActionState(action: ActionEntry | null) {
  // a new action is written in the project; a shared one is shown, not written
  const [level, setLevel] = useState<WriteLevel>(
    action !== null && action.level === 'global' ? 'global' : 'project',
  );
  const sources = action?.sources ?? {};
  const source = sources[level];
  const raw = source?.raw ?? action?.raw ?? {};
  const [draft, setDraft] = useState<ActionDraft>(() => draftOfAction(raw));
  const [newId, setNewId] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [references, setReferences] = useState<ActionReference[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = async (run: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await run();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clearAnswer = () => {
    setErrors([]);
    setReferences([]);
    setConflict(null);
  };
  return {
    level,
    setLevel,
    source,
    raw,
    draft,
    setDraft,
    newId,
    setNewId,
    errors,
    setErrors,
    references,
    setReferences,
    problem,
    setProblem,
    conflict,
    setConflict,
    busy,
    setBusy,
    attempt,
    clearAnswer,
    /** Back to what the file holds. */
    reset: () => {
      clearAnswer();
      setDraft(draftOfAction(raw));
      setNewId('');
    },
  };
}

/** The value to write for the draft, and whether it differs from the file. */
function useDirty(
  raw: Record<string, unknown>,
  draft: ActionDraft,
  newWithId: boolean,
  onDirty: (dirty: boolean) => void,
) {
  const initialValue = useMemo(() => JSON.stringify(valueOfAction(draftOfAction(raw))), [raw]);
  const value = useMemo(() => valueOfAction(draft), [draft]);
  const dirty = JSON.stringify(value) !== initialValue || newWithId;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return { value, dirty };
}

type WriteResult = Awaited<ReturnType<Api['writeAction']>>;

/** Keeps what a refused write said; true when the write went through. */
function reportWrite(state: ReturnType<typeof useActionState>, result: WriteResult): boolean {
  if (result.ok) return true;
  if (result.reason === 'conflict') state.setConflict(result.message);
  else {
    state.setErrors(result.errors);
    state.setReferences((result.references ?? []) as ActionReference[]);
  }
  return false;
}

/** The specialists to choose from, shown by name; the select keeps the one of the draft when it is gone. */
function optionsOf(view: ConfigEditorResponse): SpecialistOption[] {
  return specialistOptions(view.specialists);
}

/** «Override in the project»: writes the project copy of a shared action as it is. */
function overrideAction(
  api: Api,
  action: ActionEntry | null,
  canOverride: boolean,
  state: ReturnType<typeof useActionState>,
  report: (result: WriteResult) => boolean,
  onSaved: (id: string) => Promise<void>,
) {
  return () =>
    state.attempt(async () => {
      if (!canOverride || !action) return;
      state.clearAnswer();
      const result = await api.writeAction(action.id, { ...action.raw }, null, 'project');
      if (report(result)) {
        // the project copy exists now: show it, not the shared file
        state.setLevel('project');
        state.setDraft(draftOfAction(action.raw));
        await onSaved(action.id);
      }
    });
}

/**
 * A shared action is view only in the project: `canOverride` copies it into the project, and the
 * level switch exists only for an action that has a file at both levels.
 */
function sharedStateOf(action: ActionEntry | null, level: WriteLevel) {
  const sources = action?.sources ?? {};
  const bothLevels = Boolean(sources.global) && Boolean(sources.project);
  return {
    readOnly: action !== null && level === 'global',
    canOverride: action !== null && Boolean(sources.global) && !sources.project,
    bothLevels,
    overriding: bothLevels && level === 'project',
  };
}

/** The state and the actions (save, delete, switch the level, read again) of the action form. */
export function useActionEditor(input: ActionEditorInput) {
  const { api, view, action, onDirty, onReload, onSaved, onDeleted } = input;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const state = useActionState(action);
  const { level, source, raw, draft, newId, errors, attempt } = state;
  const id = action?.id ?? newId;
  const { value, dirty } = useDirty(raw, draft, action === null && newId !== '', onDirty);

  const report = (result: WriteResult): boolean => reportWrite(state, result);
  const shared = sharedStateOf(action, level);
  const { readOnly } = shared;
  const override = overrideAction(api, action, shared.canOverride, state, report, onSaved);
  const save = () =>
    attempt(async () => {
      if (readOnly) return;
      state.clearAnswer();
      const result = await api.writeAction(
        id,
        value,
        action ? (source?.revision ?? null) : null,
        level,
      );
      if (report(result)) await onSaved(id);
    });
  const remove = () =>
    attempt(async () => {
      if (!action || !source || readOnly) return;
      const yes = await confirm({
        title: t('settings.editor.removeTitle', {
          action: t('settings.editor.remove'),
          id: action.id,
        }),
        description: t('settings.editor.removeDescription', { file: source.file }),
        confirmLabel: t('settings.editor.remove'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      state.clearAnswer();
      const result = await api.deleteAction(action.id, source.revision, level);
      if (report(result)) await onDeleted();
    });
  const reread = async () => {
    onDirty(false);
    await onReload();
  };
  const switchLevel = async (next: WriteLevel) => {
    if (next === level) return;
    const go =
      !dirty ||
      (await confirm({
        title: t('settings.editor.switchTitle'),
        description: t('settings.editor.lostValues'),
        confirmLabel: t('settings.editor.switch'),
        cancelLabel: t('settings.editor.stay'),
        destructive: true,
      }));
    if (!go) return;
    state.clearAnswer();
    state.setDraft(draftOfAction(action?.sources[next]?.raw ?? action?.raw ?? {}));
    state.setLevel(next);
  };
  const fieldErrors = (field: Field) => errors.filter((error) => fieldOf(error.path, id) === field);
  const otherErrors = errors.filter((error) => fieldOf(error.path, id) === null);
  return {
    ...state,
    id,
    options: optionsOf(view),
    dirty,
    fieldErrors,
    otherErrors,
    ...shared,
    override,
    save,
    remove,
    reread,
    switchLevel,
  };
}
