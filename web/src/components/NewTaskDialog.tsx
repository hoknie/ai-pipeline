import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../api.ts';
import { taskNumber } from '../format.ts';
import { notifySuccess } from '../notify.ts';
import type { QueueView, RunView, WorkflowsView } from '../types.ts';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';

import { QueueForm, emptyDraft, retarget, type QueueDraft } from './QueueForm.tsx';
import { itemLabel } from './QueueList.tsx';
import { afterOptions, parentChoices } from './queueLinks.ts';
import { RepositoryPicker } from './RepositoryPicker.tsx';

function stepIds(workflow: { steps: { id: string }[] } | undefined): string[] {
  return workflow?.steps.map((step) => step.id) ?? [];
}

/** The one dialog of a new task: opened from the top strip, the queue page and the palette. */
export default function NewTaskDialog({
  api,
  selected,
  repositories,
  waiting,
  queues,
  runs = [],
  preset = null,
  onPresetApplied = () => undefined,
  open,
  onOpenChange,
  draft,
  onDraft,
  onQueue,
}: {
  /** Not bound to a repository: the dialog binds it to the repository it picks. */
  api: Api;
  /** The repository of the panel: the one the dialog opens on. */
  selected: string;
  repositories: readonly string[];
  /** Runs waiting for an answer, by repository. */
  waiting: ReadonlyMap<string, number>;
  /** The queues of all repositories the panel knows. */
  queues: ReadonlyMap<string, QueueView>;
  /** All runs of the panel: the parent choices come from them. */
  runs?: RunView[];
  /** A subtask: the repository to open on and the run to start as the parent. */
  preset?: { repository: string; parent: string } | null;
  /** The preset is in the draft: the opener forgets it. */
  onPresetApplied?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
}) {
  const { t } = useTranslation();
  // the choice is local to the dialog: it neither moves the panel nor outlives the opening
  const [target, setTarget] = useState(preset?.repository ?? selected);
  const [workflowsOf, setWorkflowsOf] = useState<ReadonlyMap<string, WorkflowsView>>(new Map());
  const scoped = useMemo(() => api.forRepository(target), [api, target]);
  const workflows = workflowsOf.get(target) ?? null;
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

  useEffect(() => {
    if (workflowsOf.has(target)) return;
    let closed = false;
    api
      .workflows(target)
      .then((view) => {
        if (!closed) setWorkflowsOf((known) => new Map(known).set(target, view));
      })
      .catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [api, target, workflowsOf]);

  // a repository without a queue in the snapshot: load it once
  const queueKnown = queue !== undefined;
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

  // a draft typed for another repository moves to the chosen one once its workflows are known
  const draftTarget = draft ? (draft.repository ?? selected) : null;
  useEffect(() => {
    if (!open || !draft || !workflows || draftTarget === target) return;
    const ids = workflows.workflows.map((workflow) => workflow.id);
    onDraft({
      ...retarget(draft, ids, (id) =>
        stepIds(workflows.workflows.find((workflow) => workflow.id === id)),
      ),
      repository: target,
    });
  }, [open, draft, workflows, draftTarget, target, onDraft]);

  // the preset parent goes into the draft once, when the draft belongs to the target repository
  const parents = useMemo(() => parentChoices(runs, target), [runs, target]);
  useEffect(() => {
    if (!open || !preset || target !== preset.repository) return;
    if (draft && draftTarget !== target) return;
    if (!workflows) return;
    const base = draft ?? emptyDraft(workflows.workflows[0]?.id);
    onDraft({ ...base, repository: target, parent: preset.parent, parentTouched: true });
    onPresetApplied();
  }, [open, preset, target, draft, draftTarget, workflows, onDraft, onPresetApplied]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-none content-start md:max-h-[90vh] md:w-[75vw]"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const field = mode.current === 'task' ? '#new-task' : '#new-group-0-title';
          document.querySelector<HTMLElement>(field)?.focus();
        }}
      >
        <DialogTitle>{t('queue.newTask')}</DialogTitle>
        <QueueForm
          idPrefix="new"
          draft={current}
          workflows={workflows}
          repository={target}
          api={scoped}
          autoDeliverDefault={queue?.autoDeliver ?? null}
          deliveryModeDefault={queue?.deliveryMode ?? null}
          afterChoices={queue ? afterOptions(queue, (item) => itemLabel(item, t)) : []}
          parentChoices={parents}
          pending={
            workflows === null ||
            queue === undefined ||
            (draft !== undefined && draftTarget !== target)
          }
          repositoryField={
            <RepositoryPicker
              id="new-repository"
              label={t('queue.form.repository')}
              repositories={repositories}
              value={target}
              waiting={waiting}
              onChange={setTarget}
            />
          }
          submitLabel={t('queue.add')}
          onDraft={(next) => onDraft({ ...next, repository: next.repository ?? target })}
          onSubmit={async (fields) => {
            const view = await scoped.queueAdd(fields);
            onQueue(view);
            onDraft({ ...emptyDraft(fields.workflow), repository: target });
            onOpenChange(false);
            const number = view.items.find((item) => item.id === view.item)?.number;
            notifySuccess(
              number === undefined
                ? t('queue.createdNoNumber')
                : t('queue.created', { number: taskNumber(number) }),
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
