import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { PipelinesView, QueueFields, QueueView, RunView } from '../../../shared/api/types.ts';
import { emptyDraft, retarget, type QueueDraft } from '../draft.ts';
import { useOpenTarget, usePresetDraft } from './usePresetDraft.ts';
import { commonPipelines, defaultSharedTag, projectsFields } from './sharedTag.ts';

function stepIds(pipeline: { steps: { id: string }[] } | undefined): string[] {
  return pipeline?.steps.map((step) => step.id) ?? [];
}

/** The pipelines of each repository the dialog has pointed at, loaded once. */
function useTargetPipelines(
  api: Api,
  targets: readonly string[],
): ReadonlyMap<string, PipelinesView> {
  const [pipelinesOf, setPipelinesOf] = useState<ReadonlyMap<string, PipelinesView>>(new Map());
  const requested = useRef(new Set<string>());
  const key = targets.join('\n');
  useEffect(() => {
    for (const target of targets) {
      if (requested.current.has(target)) continue;
      requested.current.add(target);
      api
        .pipelines(target)
        .then((view) => setPipelinesOf((known) => new Map(known).set(target, view)))
        .catch(() => requested.current.delete(target));
    }
    // `key` stands for the list of targets
  }, [api, key]);
  return pipelinesOf;
}

/** A draft typed for another repository moves to the chosen one once its pipelines are known. */
function useRetargetedDraft(input: {
  open: boolean;
  draft: QueueDraft | undefined;
  draftTarget: string | null;
  target: string;
  pipelines: PipelinesView | null;
  clearTags: boolean;
  onDraft: (draft: QueueDraft | null) => void;
}): void {
  const { open, draft, draftTarget, target, pipelines, clearTags, onDraft } = input;
  useEffect(() => {
    if (!open || !draft || !pipelines || draftTarget === target) return;
    const found = (id: string) => pipelines.pipelines.find((pipeline) => pipeline.id === id);
    onDraft({
      ...retarget(
        draft,
        pipelines.pipelines.map((pipeline) => pipeline.id),
        (id) => stepIds(found(id)),
        (id) => found(id)?.variants.map((variant) => variant.id) ?? [],
      ),
      ...(clearTags ? { tags: [] } : {}),
      repository: target,
    });
  }, [open, draft, pipelines, draftTarget, target, clearTags, onDraft]);
}

/** A repository without a queue in the snapshot: load it once. */
function useTargetQueue(
  scoped: Api,
  queueKnown: boolean,
  onQueue: (queue: QueueView) => void,
): void {
  useEffect(() => {
    if (queueKnown) return;
    let closed = false;
    scoped
      .queue()
      .then((view) => {
        if (!closed) onQueue(view);
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [scoped, queueKnown, onQueue]);
}

/** The task in several projects: the projects in the order of the chain and the shared fields. */
function useMultiProjects(input: {
  target: string;
  setTarget: (target: string) => void;
  mode: QueueDraft['mode'];
  onMode: () => void;
}) {
  const { target, setTarget, mode, onMode } = input;
  const [on, setOn] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // null: the field follows the title of the task
  const [tag, setTag] = useState<string | null>(null);
  const [chain, setChain] = useState(false);
  const choose = (next: string[]) => {
    setProjects(next);
    if (next[0] !== undefined && next[0] !== target) setTarget(next[0]);
  };
  return {
    on,
    projects,
    notes,
    tag,
    chain,
    choose,
    toggle: (enabled: boolean) => {
      setOn(enabled);
      if (enabled) {
        setProjects([target]);
        if (mode === 'groups') onMode();
      } else {
        setProjects([]);
      }
    },
    setNote: (project: string, text: string) =>
      setNotes((known) => ({ ...known, [project]: text })),
    setTag,
    setChain,
    reset: () => {
      setOn(false);
      setProjects([]);
      setNotes({});
      setTag(null);
      setChain(false);
    },
    clearText: () => {
      setNotes({});
      setTag(null);
    },
  };
}

/** The pipeline, variant and skipped steps of the draft stay among those every project has. */
function useCommonDraft(input: {
  draft: QueueDraft | undefined;
  common: PipelinesView | null;
  onDraft: (draft: QueueDraft | null) => void;
}): void {
  const { draft, common, onDraft } = input;
  useEffect(() => {
    if (!draft || !common || draft.pipeline === '') return;
    const pipeline = common.pipelines.find((candidate) => candidate.id === draft.pipeline);
    if (pipeline === undefined) {
      onDraft({ ...draft, pipeline: common.pipelines[0]?.id ?? '', variant: 'default', skip: [] });
      return;
    }
    const steps = pipeline.steps.map((step) => step.id);
    const variant = pipeline.variants.some((candidate) => candidate.id === draft.variant)
      ? draft.variant
      : 'default';
    const skip = draft.skip.filter((id) => steps.includes(id));
    if (variant !== draft.variant || skip.length !== draft.skip.length) {
      onDraft({ ...draft, variant, skip });
    }
  }, [draft, common, onDraft]);
}

/** Adds the task to its queue, or to the queues of the chosen projects, and tells the user. */
function useTaskSubmit(input: {
  api: Api;
  scoped: Api;
  multi: ReturnType<typeof useMultiProjects>;
  sharedTag: string;
  target: string;
  onQueue: (queue: QueueView) => void;
  onDraft: (draft: QueueDraft | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { api, scoped, multi, sharedTag, target, onQueue } = input;
  const add = async (fields: QueueFields) => {
    if (multi.on) {
      const added = await api.queueAddProjects(
        projectsFields(fields, {
          projects: multi.projects,
          notes: multi.notes,
          tag: sharedTag,
          chain: multi.chain,
        }),
      );
      notifySuccess(t('queue.multi.created', { count: added.length }));
      return;
    }
    const view = await scoped.queueAdd(fields);
    onQueue(view);
    const number = view.items.find((item) => item.id === view.item)?.number;
    notifySuccess(
      number === undefined
        ? t('queue.createdNoNumber')
        : t('queue.created', { number: taskNumber(number) }),
    );
  };
  return {
    submit: async (fields: QueueFields) => {
      await add(fields);
      input.onDraft({ ...emptyDraft(fields.pipeline), repository: target });
      multi.reset();
      input.onOpenChange(false);
    },
    submitAndContinue: async (fields: QueueFields) => {
      await add(fields);
      multi.clearText();
    },
  };
}

/** The repository the dialog targets, what is loaded for it, and the draft kept in step with it. */
export function useNewTaskState(props: {
  api: Api;
  selected: string;
  runs?: RunView[];
  queues: ReadonlyMap<string, QueueView>;
  preset?: { repository: string; parent: string | null } | null;
  onPresetApplied?: () => void;
  open: boolean;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { api, selected, queues, open, draft, onDraft, onQueue } = props;
  const { preset = null, onPresetApplied = () => undefined } = props;
  // the choice is local to the dialog: it neither moves the panel nor outlives the opening
  const [target, setTarget] = useState(preset?.repository ?? selected);
  const scoped = useMemo(() => api.forRepository(target), [api, target]);
  const current = draft ?? emptyDraft();
  const multi = useMultiProjects({
    target,
    setTarget,
    mode: current.mode,
    onMode: () => onDraft({ ...current, mode: 'task', repository: current.repository ?? target }),
  });
  const loaded = useTargetPipelines(api, multi.on ? multi.projects : [target]);
  const targetPipelines = loaded.get(target) ?? null;
  const common = multi.on ? commonPipelines(multi.projects.map((path) => loaded.get(path))) : null;
  const pipelines = multi.on ? common : targetPipelines;
  useCommonDraft({ draft: multi.on ? draft : undefined, common, onDraft });
  const queue = queues.get(target);
  const mode = useRef<'task' | 'groups'>('task');
  mode.current = current.mode;

  useOpenTarget(open, selected, preset, setTarget, multi.reset);

  const queueKnown = queue !== undefined;
  useTargetQueue(scoped, queueKnown, onQueue);

  const draftTarget = draft ? (draft.repository ?? selected) : null;
  useRetargetedDraft({
    open,
    draft,
    draftTarget,
    target,
    pipelines: targetPipelines,
    onDraft,
    clearTags: preset?.parent != null && preset.repository === target,
  });

  usePresetDraft({
    ...{ open, preset, target, draft, draftTarget, pipelines: targetPipelines },
    ...{ onDraft, onPresetApplied },
  });
  const sharedTag = multi.tag ?? defaultSharedTag(current.title);
  const { submit, submitAndContinue } = useTaskSubmit({
    ...{ api, scoped, multi, sharedTag, target, onQueue, onDraft },
    onOpenChange: props.onOpenChange,
  });
  return {
    submit,
    submitAndContinue,
    target,
    setTarget,
    scoped,
    pipelines,
    queue,
    current,
    mode,
    draftTarget,
    multi: {
      ...multi,
      sharedTag,
      /** Every selected project is loaded and no pipeline is common to them. */
      noCommon: multi.on && common !== null && common.pipelines.length === 0,
    },
  };
}
