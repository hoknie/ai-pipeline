import { useEffect, useMemo, useRef, useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type {
  ConfigEditorResponse,
  EditorPipeline,
  EntryReference,
  FieldError,
  PipelineTopology,
  WriteLevel,
} from '../../../shared/api/types.ts';
import type { SharedPipelineOnly } from './PipelineUsage.tsx';
import { draftOf, valueOf, type Draft } from './steps/draft.ts';

export const PREVIEW_DELAY_MS = 300;

export interface EditorInput {
  view: ConfigEditorResponse;
  /** null for a new pipeline. */
  pipeline: EditorPipeline | null;
  sharedOnly?: SharedPipelineOnly | undefined;
  onDirty: (dirty: boolean) => void;
}

/** The file of a level, or the one that applies when the level has none. */
export function levelFile(pipeline: EditorPipeline | null, level: WriteLevel) {
  const sources = pipeline?.sources ?? {};
  const source = sources[level];
  return {
    sources,
    source,
    bothLevels: Boolean(sources.project && sources.global),
    raw: source?.raw ?? pipeline?.raw ?? {},
  };
}

/** What the person is editing: the level, the draft, the id of a new pipeline. */
export function useEditorFields(pipeline: EditorPipeline | null, sharedOnly?: SharedPipelineOnly) {
  const [level, setLevel] = useState<WriteLevel>(
    sharedOnly || pipeline?.level === 'global' ? 'global' : 'project',
  );
  const [draft, setDraft] = useState<Draft>(() => draftOf(levelFile(pipeline, level).raw));
  const [newId, setNewId] = useState('');
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('form');
  return {
    level,
    setLevel,
    draft,
    setDraft,
    newId,
    setNewId,
    saveAs,
    setSaveAs,
    busy,
    setBusy,
    tab,
    setTab,
  };
}

/** What the last write and the preview said. */
export function useEditorFeedback() {
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [references, setReferences] = useState<EntryReference[]>([]);
  return {
    errors,
    setErrors,
    problem,
    setProblem,
    conflict,
    setConflict,
    references,
    setReferences,
  };
}

/** What follows from the fields: the file of the level, the value to write, the dirty flag. */
export function useEditorDerived(
  { pipeline, sharedOnly, onDirty }: EditorInput,
  { level, draft, newId }: ReturnType<typeof useEditorFields>,
) {
  const file = levelFile(pipeline, level);
  const initialValue = useMemo(() => JSON.stringify(valueOf(draftOf(file.raw))), [file.raw]);
  const value = useMemo(() => valueOf(draft), [draft]);
  const dirty = JSON.stringify(value) !== initialValue || (!pipeline && newId !== '');
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return {
    ...file,
    value,
    dirty,
    id: pipeline?.id ?? newId,
    // a shared pipeline is view only on the project page; settings are where it is changed
    readOnly: Boolean(pipeline) && level === 'global' && !sharedOnly,
  };
}

/** The graph of the draft from the daemon; answers to an older draft are dropped. */
export function usePreview(
  api: Api,
  id: string,
  value: Record<string, unknown>,
  level: WriteLevel,
  feedback: ReturnType<typeof useEditorFeedback>,
) {
  const [preview, setPreview] = useState<{ topology: PipelineTopology | null; stale: boolean }>({
    topology: null,
    stale: false,
  });
  const latest = useRef(0);
  const { setErrors, setProblem } = feedback;
  useEffect(() => {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) return;
    const request = ++latest.current;
    const timer = setTimeout(() => {
      api.previewPipeline(id, value, level).then(
        (result) => {
          if (request !== latest.current) return;
          setErrors(result.errors);
          setPreview((current) =>
            result.topology
              ? { topology: result.topology, stale: false }
              : { topology: current.topology, stale: true },
          );
        },
        (error: Error) => {
          if (request === latest.current) setProblem(error.message);
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, id, value, level, setErrors, setProblem]);
  return preview;
}
