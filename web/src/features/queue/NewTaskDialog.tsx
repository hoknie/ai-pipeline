import { Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { QueueView, RunView } from '../../shared/api/types.ts';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../shared/ui/feedback/tooltip.tsx';
import { Dialog, DialogContent, DialogTitle } from '../../shared/ui/overlays/dialog.tsx';

import { QueueForm, emptyDraft, type QueueDraft } from './QueueForm.tsx';
import { focusNewTaskField } from './form/focusNewTaskField.ts';
import { useNewTaskState } from './form/useNewTaskState.ts';
import { itemLabel } from './list/itemText.ts';
import { afterOptions } from './queueLinks.ts';
import { RepositoryPicker } from '../repositories/index.ts';

/** The one dialog of a new task: opened from the top strip, the queue page and the palette. */
type Props = {
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
  preset?: { repository: string; parent: string | null } | null;
  /** The preset is in the draft: the opener forgets it. */
  onPresetApplied?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  /** Moves the form to its own page; the repository of the dialog goes with it. */
  onExpand?: (repository: string) => void;
};

/** The one dialog of a new task: opened from the top strip, the queue page and the palette. */
export default function NewTaskDialog(props: Props) {
  const { t } = useTranslation();
  const { open, onOpenChange, repositories, waiting, draft, onDraft } = props;
  const state = useNewTaskState(props);
  const { target, setTarget, scoped, pipelines, queue, current, mode, draftTarget, parents } =
    state;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-none content-start md:max-h-[90vh] md:w-[75vw]"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusNewTaskField(mode.current);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <DialogTitle>{t('queue.newTask')}</DialogTitle>
          {props.onExpand ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mr-8"
                  aria-label={t('queue.page.expand')}
                  onClick={() => props.onExpand?.(target)}
                >
                  <Maximize2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('queue.page.expand')}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <QueueForm
          idPrefix="new"
          draft={current}
          pipelines={pipelines}
          repository={target}
          api={scoped}
          autoDeliverDefault={queue?.autoDeliver ?? null}
          deliveryModeDefault={queue?.deliveryMode ?? null}
          afterChoices={queue ? afterOptions(queue, (item) => itemLabel(item, t)) : []}
          parentChoices={parents}
          pending={
            pipelines === null ||
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
          onSubmit={state.submit}
          onSubmitAndContinue={state.submitAndContinue}
        />
      </DialogContent>
    </Dialog>
  );
}
