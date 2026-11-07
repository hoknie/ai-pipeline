import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { WriteLevel } from '../../../shared/api/types.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { draftOf, valueOf } from './draft.ts';
import type {
  EditorInput,
  useEditorDerived,
  useEditorFeedback,
  useEditorFields,
} from './editorState.ts';

export interface EditorCallbacks {
  api: Api;
  onReload: () => Promise<void>;
  onSaved: (slug: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

type Fields = ReturnType<typeof useEditorFields>;
type Feedback = ReturnType<typeof useEditorFeedback>;
type Derived = ReturnType<typeof useEditorDerived>;

/**
 * The value written to a file of the level. The tags of a shared file are changed only in the file:
 * a shared file keeps its tags as they are and a new shared file has none.
 */
function forLevel(
  value: Record<string, unknown>,
  level: WriteLevel,
  stored: Record<string, unknown> | null,
): Record<string, unknown> {
  if (level !== 'global') return value;
  const { tags: _tags, ...rest } = value;
  return stored !== null && stored.tags !== undefined ? { ...rest, tags: stored.tags } : rest;
}

/** Writes: save, save as a copy, copy to the other level. */
export function useWriteActions(
  input: EditorInput,
  { api, onSaved }: EditorCallbacks,
  fields: Fields,
  feedback: Feedback,
  derived: Derived,
) {
  const { specialist, sharedOnly } = input;
  const { level, draft, slug, saveAs, setBusy } = fields;
  const { raw, revision, source } = derived;
  const report = (result: Awaited<ReturnType<Api['writeSpecialist']>>): boolean => {
    if (result.ok) return true;
    if (result.reason === 'conflict') feedback.setConflict(result.message);
    else {
      feedback.setErrors(result.errors);
      feedback.setReferences(result.references ?? []);
      if (sharedOnly && (result.references ?? []).length > 0) sharedOnly.onUsageStale();
    }
    return false;
  };
  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    feedback.setProblem(null);
    try {
      await action();
    } catch (error) {
      feedback.setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const write = (target: string, stored: Record<string, unknown> | null, rev: string | null) =>
    attempt(async () => {
      feedback.clear();
      const value = forLevel(valueOf(draft, raw), level, stored);
      if (report(await api.writeSpecialist(target, value, rev, level))) await onSaved(target);
    });
  const save = () =>
    write(
      specialist ? specialist.slug : slug,
      specialist && source ? raw : null,
      specialist ? revision : null,
    );
  const saveCopy = () => write(saveAs ?? '', null, null);
  /** Copies the file that applies to the other level, which has none. */
  const copyTo = (target: WriteLevel) =>
    attempt(async () => {
      // the copy has no tags: the tags of the source level stay there
      const { tags: _tags, ...copy } = specialist?.raw ?? {};
      const result = await api.writeSpecialist(specialist?.slug ?? '', copy, null, target);
      if (report(result)) await onSaved(specialist?.slug ?? '');
    });
  return { report, attempt, save, saveCopy, copyTo };
}

/** Actions that ask the person first: switch the level, delete, read the file again. */
export function useGuardedActions(
  input: EditorInput,
  { api, onReload, onDeleted }: EditorCallbacks,
  fields: Fields,
  feedback: Feedback,
  derived: Derived,
  write: ReturnType<typeof useWriteActions>,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { specialist, sharedOnly, onDirty } = input;
  const { level, setLevel, setDraft } = fields;
  const { dirty, source, sources } = derived;
  const removeLabel =
    level === 'project' && sources.global
      ? t('settings.editor.removeOverride')
      : t('settings.editor.remove');
  const discardsEdits = async (title: string, confirmLabel: string, cancelLabel?: string) =>
    !dirty ||
    (await confirm({
      title,
      description: t('settings.editor.lostValues'),
      confirmLabel,
      ...(cancelLabel ? { cancelLabel } : {}),
      destructive: true,
    }));
  const switchLevel = async (next: WriteLevel) => {
    if (next === level) return;
    const go = await discardsEdits(
      t('settings.editor.switchTitle'),
      t('settings.editor.switch'),
      t('settings.editor.stay'),
    );
    if (!go) return;
    feedback.clear();
    feedback.setReferences([]);
    setDraft(draftOf(specialist?.sources[next]?.raw ?? specialist?.raw ?? {}));
    setLevel(next);
  };
  const remove = () =>
    write.attempt(async () => {
      if (!specialist || !source) return;
      const yes = await confirm({
        title: t('settings.editor.removeTitle', { action: removeLabel, id: specialist.slug }),
        description: t('settings.editor.removeDescription', { file: source.file }),
        confirmLabel: removeLabel,
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      feedback.setReferences([]);
      const result = await api.deleteSpecialist(specialist.slug, source.revision, level);
      if (write.report(result)) await onDeleted();
    });
  const reread = async () => {
    if (!(await discardsEdits(t('specialists.rereadTitle'), t('settings.editor.reread')))) return;
    onDirty(false);
    await onReload();
  };
  const removeBlocked =
    sharedOnly !== undefined &&
    (sharedOnly.usage === null ||
      sharedOnly.usage.projects.length > 0 ||
      sharedOnly.usage.global.length > 0);
  const removeBlockedReason =
    sharedOnly?.usage === null
      ? t('sharedSpecialists.usage.waiting')
      : t('sharedSpecialists.usage.blocked');
  return { removeLabel, switchLevel, remove, reread, removeBlocked, removeBlockedReason };
}
