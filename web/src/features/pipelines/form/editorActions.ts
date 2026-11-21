import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { WriteLevel } from '../../../shared/api/types.ts';
import { forgetPreference } from '../../../shared/lib/browser/preferences.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type {
  EditorInput,
  useEditorDerived,
  useEditorFeedback,
  useEditorFields,
} from './editorState.ts';
import { anchorsKey } from './canvas/canvasAnchors.ts';
import { layoutKey } from './canvas/useCanvasLayout.ts';
import { draftOf } from './steps/draft.ts';

export interface EditorCallbacks {
  api: Api;
  activeRuns: number;
  onReload: () => Promise<void>;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

type Fields = ReturnType<typeof useEditorFields>;
type Feedback = ReturnType<typeof useEditorFeedback>;
type Derived = ReturnType<typeof useEditorDerived>;

/** Writes: save, save as a copy, copy to the other level. */
export function useWriteActions(
  input: EditorInput,
  { api, onSaved }: EditorCallbacks,
  fields: Fields,
  feedback: Feedback,
  derived: Derived,
) {
  const { pipeline, sharedOnly } = input;
  const { level, saveAs, setBusy } = fields;
  const { value, source, id, readOnly } = derived;
  const report = (result: Awaited<ReturnType<Api['writePipeline']>>): boolean => {
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
  // outside the shared page a copy is always written to the project
  const copyLevel: WriteLevel = sharedOnly ? level : 'project';
  const write = (target: string, revision: string | null, into: WriteLevel = level) =>
    attempt(async () => {
      if (readOnly) return;
      feedback.setConflict(null);
      const result = await api.writePipeline(target, value, revision, into);
      if (report(result)) await onSaved(target);
    });
  const save = () => write(id, pipeline ? (source?.revision ?? null) : null);
  const saveCopy = () => write(saveAs ?? '', null, copyLevel);
  /** Copies the shared file into the project, which has none; nothing is ever written to the shared level this way. */
  const copyToProject = () =>
    attempt(async () => {
      // tags belong to the file they are written in: the copy starts without them
      const { tags: _tags, ...rest } = pipeline?.raw ?? {};
      const result = await api.writePipeline(id, rest, null, 'project');
      if (report(result)) await onSaved(id);
    });
  return { report, attempt, save, saveCopy, copyToProject };
}

/** Actions that ask the person first: switch the level, delete, read the file again. */
export function useGuardedActions(
  input: EditorInput,
  { api, activeRuns, onReload, onDeleted }: EditorCallbacks,
  fields: Fields,
  feedback: Feedback,
  derived: Derived,
  write: ReturnType<typeof useWriteActions>,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { pipeline, sharedOnly, onDirty } = input;
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
    feedback.setErrors([]);
    feedback.setConflict(null);
    setDraft(draftOf(pipeline?.sources[next]?.raw ?? pipeline?.raw ?? {}));
    fields.setSaveAs(null);
    setLevel(next);
  };
  const remove = () =>
    write.attempt(async () => {
      if (!pipeline || !source) return;
      const running = activeRuns > 0 ? t('pipelines.runningRuns', { count: activeRuns }) : '';
      const yes = await confirm({
        title: t('settings.editor.removeTitle', { action: removeLabel, id: pipeline.id }),
        description: `${t('settings.editor.removeDescription', { file: source.file })}${running}`,
        confirmLabel: removeLabel,
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!yes) return;
      feedback.setReferences([]);
      const result = await api.deletePipeline(pipeline.id, source.revision, level);
      if (write.report(result)) {
        const repository = sharedOnly ? 'global' : input.view.repository;
        forgetPreference(layoutKey(repository, pipeline.id));
        forgetPreference(anchorsKey(repository, pipeline.id));
        await onDeleted();
      }
    });
  const reread = async () => {
    if (!(await discardsEdits(t('pipelines.rereadTitle'), t('settings.editor.reread')))) return;
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
      ? t('sharedPipelines.usage.waiting')
      : t('sharedPipelines.usage.blocked');
  return { removeLabel, switchLevel, remove, reread, removeBlocked, removeBlockedReason };
}
