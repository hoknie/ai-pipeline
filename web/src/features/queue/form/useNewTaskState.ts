import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { taskNumber } from '../../../shared/lib/format.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { PipelinesView, QueueFields, QueueView, RunView } from '../../../shared/api/types.ts';
import { emptyDraft, retarget, type QueueDraft } from '../draft.ts';
import { parentChoices } from '../queueLinks.ts';

function stepIds(pipeline: { steps: { id: string }[] } | undefined): string[] {
  return pipeline?.steps.map((step) => step.id) ?? [];
}

/** The pipelines of each repository the dialog has pointed at, loaded once. */
function useTargetPipelines(api: Api, target: string): PipelinesView | null {
  const [pipelinesOf, setPipelinesOf] = useState<ReadonlyMap<string, PipelinesView>>(new Map());
  useEffect(() => {
    if (pipelinesOf.has(target)) return;
    let closed = false;
    api
      .pipelines(target)
      .then((view) => {
        if (!closed) setPipelinesOf((known) => new Map(known).set(target, view));
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [api, target, pipelinesOf]);
  return pipelinesOf.get(target) ?? null;
}

/** A draft typed for another repository moves to the chosen one once its pipelines are known. */
function useRetargetedDraft(input: {
  open: boolean;
  draft: QueueDraft | undefined;
  draftTarget: string | null;
  target: string;
  pipelines: PipelinesView | null;
  onDraft: (draft: QueueDraft | null) => void;
}): void {
  const { open, draft, draftTarget, target, pipelines, onDraft } = input;
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
      repository: target,
    });
  }, [open, draft, pipelines, draftTarget, target, onDraft]);
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

/** The repository the dialog targets, what is loaded for it, and the draft kept in step with it. */
export function useNewTaskState(props: {
  api: Api;
  selected: string;
  runs?: RunView[];
  queues: ReadonlyMap<string, QueueView>;
  preset?: { repository: string; parent: string } | null;
  onPresetApplied?: () => void;
  open: boolean;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { api, selected, queues, open, draft, onDraft, onQueue } = props;
  const { runs = [], preset = null, onPresetApplied = () => undefined } = props;
  // the choice is local to the dialog: it neither moves the panel nor outlives the opening
  const [target, setTarget] = useState(preset?.repository ?? selected);
  const scoped = useMemo(() => api.forRepository(target), [api, target]);
  const pipelines = useTargetPipelines(api, target);
  const queue = queues.get(target);
  const current = draft ?? emptyDraft();
  const mode = useRef<'task' | 'groups'>('task');
  mode.current = current.mode;

  // the target is chosen on opening only: forgetting the preset must not move it back
  const wasOpen = useRef(false);
  const latest = useRef({ selected, preset });
  latest.current = { selected, preset };
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTarget(latest.current.preset?.repository ?? latest.current.selected);
    }
    wasOpen.current = open;
  }, [open]);

  const queueKnown = queue !== undefined;
  useTargetQueue(scoped, queueKnown, onQueue);

  const draftTarget = draft ? (draft.repository ?? selected) : null;
  useRetargetedDraft({ open, draft, draftTarget, target, pipelines, onDraft });

  // the preset parent goes into the draft once, when the draft belongs to the target repository
  const parents = useMemo(() => parentChoices(runs, target), [runs, target]);
  useEffect(() => {
    if (!open || !preset || target !== preset.repository) return;
    if (draft && draftTarget !== target) return;
    if (!pipelines) return;
    const base = draft ?? emptyDraft(pipelines.pipelines[0]?.id);
    onDraft({ ...base, repository: target, parent: preset.parent, parentTouched: true });
    onPresetApplied();
  }, [open, preset, target, draft, draftTarget, pipelines, onDraft, onPresetApplied]);
  const submit = async (fields: QueueFields) => {
    const view = await scoped.queueAdd(fields);
    onQueue(view);
    onDraft({ ...emptyDraft(fields.pipeline), repository: target });
    props.onOpenChange(false);
    const number = view.items.find((item) => item.id === view.item)?.number;
    notifySuccess(
      number === undefined
        ? t('queue.createdNoNumber')
        : t('queue.created', { number: taskNumber(number) }),
    );
  };
  return {
    submit,
    target,
    setTarget,
    scoped,
    pipelines,
    queue,
    current,
    mode,
    draftTarget,
    parents,
  };
}
