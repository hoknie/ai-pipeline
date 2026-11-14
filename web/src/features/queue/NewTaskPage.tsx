import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import type { QueueView, RunView } from '../../shared/api/types.ts';
import { takeFocusRequest } from '../../shared/lib/browser/hotkeys.ts';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { RepositoryPicker } from '../repositories/index.ts';

import { QueueForm, type QueueDraft } from './QueueForm.tsx';
import { focusNewTaskField } from './form/focusNewTaskField.ts';
import { useNewTaskState } from './form/useNewTaskState.ts';
import { itemLabel } from './list/itemText.ts';
import { afterOptions } from './queueLinks.ts';

type Props = {
  /** Not bound to a repository: the page binds it to the repository it picks. */
  api: Api;
  /** The repository of the panel: the one the page opens on. */
  selected: string;
  repositories: readonly string[];
  waiting: ReadonlyMap<string, number>;
  queues: ReadonlyMap<string, QueueView>;
  runs?: RunView[];
  /** The repository the page opens on, when it differs from the panel's. */
  preset?: { repository: string; parent: string | null } | null;
  onPresetApplied?: () => void;
  draft: QueueDraft | undefined;
  onDraft: (draft: QueueDraft | null) => void;
  onQueue: (queue: QueueView) => void;
  /** Leaves the page for the queue. */
  onLeave: () => void;
};

/** The form of a new task on a page of its own: the same state and draft as the dialog. */
export default function NewTaskPage(props: Props) {
  const { t } = useTranslation();
  const { onLeave, repositories, waiting, draft, onDraft } = props;
  const state = useNewTaskState({ ...props, open: true, onOpenChange: () => onLeave() });
  const { target, setTarget, scoped, pipelines, queue, current, mode, draftTarget, parents } =
    state;

  useEffect(() => {
    const focus = () => focusNewTaskField(mode.current);
    focus();
    return takeFocusRequest('new-task-page', focus);
    // the form is drawn once the queue is known
  }, [mode, queue === undefined]);

  return (
    <div className="flex min-h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <a href="#queue">{t('queue.page.back')}</a>
        </Button>
        <h1 className="text-lg font-semibold">{t('queue.page.title')}</h1>
      </div>
      {queue === undefined ? (
        <div role="status" aria-label={t('queue.loading')}>
          <Skeleton className="h-24" />
        </div>
      ) : (
        <QueueForm
          fill
          idPrefix="new"
          draft={current}
          pipelines={pipelines}
          repository={target}
          api={scoped}
          autoDeliverDefault={queue.autoDeliver ?? null}
          deliveryModeDefault={queue.deliveryMode ?? null}
          afterChoices={afterOptions(queue, (item) => itemLabel(item, t))}
          parentChoices={parents}
          pending={pipelines === null || (draft !== undefined && draftTarget !== target)}
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
          onCancel={onLeave}
        />
      )}
    </div>
  );
}
