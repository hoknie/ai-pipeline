import { Inbox, MousePointerClick } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { modLabel } from '../../../shared/lib/browser/hotkeys.ts';
import { useOutOfView } from '../../../shared/lib/browser/useOutOfView.ts';
import { defaultEntry, orderEntries } from '../../../shared/lib/order.ts';
import type { RunView } from '../../../shared/api/types.ts';
import { Empty } from '../../../shared/ui/feedback/empty.tsx';
import { Kbd } from '../../../shared/ui/feedback/kbd.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { GroupScreen } from '../group/GroupScreen.tsx';
import { canDeliver } from '../header/delivery.ts';
import { RunHeader } from '../header/RunHeader.tsx';
import { useDeliveryOutcome } from '../header/useDeliveryOutcome.ts';
import type { RunsPageProps } from './types.ts';

export type DetailProps = Pick<
  RunsPageProps,
  | 'api'
  | 'runs'
  | 'loaded'
  | 'openedState'
  | 'route'
  | 'now'
  | 'drafts'
  | 'onDraft'
  | 'onClearDrafts'
  | 'onError'
  | 'onlyReplies'
  | 'onOnlyReplies'
  | 'onRoute'
  | 'onSubtask'
> & {
  run: RunView | null;
  onSelect: (runId: string, group: string | null) => void;
};

/** What stands in place of the run when there is none open: loading, unknown, or the choice. */
function Placeholder({ props }: { props: DetailProps }) {
  const { t } = useTranslation();
  const { openedState = null, route, loaded } = props;
  if (openedState === 'loading') {
    return (
      <div role="status" aria-label={t('runs.page.connecting')} className="flex flex-col gap-2 p-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (openedState === 'missing') {
    return (
      <Empty icon={<Inbox />} title={t('runs.page.notFound')} className="m-auto">
        <p className="font-mono">{route.run}</p>
      </Empty>
    );
  }
  if (!loaded) return null;
  return (
    <Empty icon={<MousePointerClick />} title={t('runs.page.choose')} className="m-auto">
      <p>
        {t('runs.page.chooseHint')} <Kbd>{modLabel()}K</Kbd>
      </p>
    </Empty>
  );
}

/** The open run: its header and the screen of the open group or step. */
export function RunDetail(props: DetailProps) {
  const { t } = useTranslation();
  const { api, runs, run, route, now, onSelect, onRoute } = props;
  const [headerElement, setHeaderElement] = useState<HTMLElement | null>(null);
  const headerOut = useOutOfView(headerElement);
  const deliver = useDeliveryOutcome(api, runs);
  if (!run) return <Placeholder props={props} />;
  const group =
    orderEntries(run).find((candidate) => candidate.slug === route.group) ?? defaultEntry(run);
  return (
    <>
      <RunHeader
        run={run}
        api={api}
        now={now}
        onError={props.onError}
        onDeliver={(force) => deliver(run, force)}
        onSubtask={props.onSubtask}
        onSelect={(slug) => onSelect(run.id, slug)}
        headerRef={setHeaderElement}
        entry={group}
      />
      {group ? (
        <GroupScreen
          key={`${run.id}/${group.slug}/${route.step ?? ''}`}
          api={api}
          runId={run.id}
          row={group}
          openStep={route.group === group.slug ? route.step : null}
          tab={route.group === null || route.group === group.slug ? route.tab : null}
          onTab={(tab) => onRoute({ ...route, group: group.slug, tab: tab === 'log' ? null : tab })}
          draftKey={`${run.id}/${group.slug}`}
          drafts={props.drafts}
          onDraft={props.onDraft}
          onClearDrafts={props.onClearDrafts}
          onError={props.onError}
          onlyReplies={props.onlyReplies}
          onOnlyReplies={props.onOnlyReplies}
          deliverable={canDeliver(run)}
          onDeliver={() => deliver(run, false)}
          run={run}
          onForceDeliver={() => deliver(run, true)}
          showUsage={headerOut}
          onSelectEntry={(slug) => onSelect(run.id, slug)}
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t('runs.page.noGroups')}</p>
      )}
    </>
  );
}
