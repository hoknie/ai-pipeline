import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { repairOf } from '../../../shared/api/observerTypes.ts';
import type { GroupRow, RunView, SystemStepRow } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { PipelineBadge } from '../../../shared/ui/feedback/PipelineBadge.tsx';
import { TagPicker } from '../../tags/index.ts';
import { RunTitle } from './RunTitle.tsx';
import { RunSteps } from './RunSteps.tsx';
import { RunSummary } from './RunSummary.tsx';
import { MoreMenu, RunButtons, RunWarnings } from './RunHeaderParts.tsx';
import {
  useRetryFailed,
  useRunDelivery,
  useRunHold,
  useRunObserver,
  useRunTags,
} from './useRunHeader.ts';

import { ApplyDialog } from './ApplyDialog.tsx';

function RunInfo({
  run,
  api,
  tags,
}: {
  run: RunView;
  api: Api;
  tags: ReturnType<typeof useRunTags>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RunTitle run={run} api={api} />
      </div>
      <div>
        <PipelineBadge id={run.pipeline} name={run.pipelineName} />
      </div>
      {run.name ? <div className="font-mono text-xs text-muted-foreground">{run.name}</div> : null}
      <div className="flex flex-col gap-1">
        <TagPicker
          label={t('runs.header.tags')}
          selected={tags.runTagIds}
          repository={run.repository}
          onChange={(ids, fresh) => void tags.changeTags(ids, fresh)}
          api={api}
          allowCreate
          disabled={tags.tagging}
          hideLinked
        />
        {tags.tagError ? <Alert variant="destructive">{tags.tagError}</Alert> : null}
      </div>
    </>
  );
}

export function RunHeader({
  run,
  api,
  now,
  onError,
  onSelect,
  onDeliver,
  onSubtask,
  headerRef,
  entry = null,
}: {
  run: RunView;
  api: Api;
  now: number;
  onError: (message: string) => void;
  /** Opens a group or a system step of the run. */
  onSelect?: (slug: string) => void;
  /** Delivers the run and reports the outcome; without it the header only calls `apply`. */
  onDeliver?: (force: boolean) => Promise<unknown>;
  /** Opens a new task as a child of the run; without it the menu has no such item. */
  onSubtask?: (run: RunView) => void;
  /** Receives the header element, to know when it is scrolled out of view. */
  headerRef?: (element: HTMLElement | null) => void;
  /** The open group or system step; its status joins the statuses of the summary. */
  entry?: GroupRow | SystemStepRow | null;
}) {
  const { t } = useTranslation();
  const repair = repairOf(run);
  const hold = useRunHold(run, api, onError);
  const observer = useRunObserver(run, api);
  const tags = useRunTags(run, api);
  const retry = useRetryFailed(run, api, onError);
  const delivery = useRunDelivery(run, api, onError, onDeliver);
  return (
    <header ref={headerRef} aria-label={t('runs.header.label')} className="@container border-b p-4">
      <div className="flex flex-col gap-4 @3xl:flex-row @3xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <RunInfo run={run} api={api} tags={tags} />
          <RunWarnings run={run} repair={repair} />
          <div className="flex flex-wrap items-center gap-2">
            <RunButtons
              run={run}
              repair={repair}
              observer={observer}
              hold={hold}
              delivery={delivery}
            />
            <RunSteps run={run} api={api} onError={onError} />
            <MoreMenu run={run} retry={retry} delivery={delivery} onSubtask={onSubtask} />
          </div>
        </div>
        <RunSummary
          run={run}
          now={now}
          entry={entry}
          onSelect={onSelect}
          api={api}
          onError={onError}
        />
      </div>
      {delivery.forcing ? (
        <ApplyDialog
          run={run}
          api={api}
          onConfirm={() => void delivery.apply(true)}
          onClose={() => delivery.setForcing(false)}
        />
      ) : null}
    </header>
  );
}
