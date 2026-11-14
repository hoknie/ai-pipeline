import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFollowEnd } from '../../../../shared/lib/browser/useFollowEnd.ts';

import { capabilities } from './capabilities.ts';
import type { GroupScreenProps } from './types.ts';
import {
  useGroupAct,
  useGroupCommands,
  useGroupSkip,
  useGroupTabs,
  useGroupView,
  useStatusesMounted,
} from './useGroupParts.ts';

/** Everything the parts of the screen of a group read: the props, the loaded group, the commands. */
export function useGroupCtx(props: GroupScreenProps, section: HTMLElement | null = null) {
  const { api, runId, row, run, onError } = props;
  const { showUsage = false, deliverable = false } = props;
  const { t } = useTranslation();
  const version = `${row.status}/${row.step}/${row.round}/${row.diff?.added ?? ''}/${row.diffRevision ?? ''}/${row.delivery}/${row.usage?.inputTokens ?? ''}/${row.usage?.outputTokens ?? ''}/${run?.delivery.inProgress ?? ''}/${run?.delivery.finishedAt ?? ''}/${row.artifacts}/${row.artifactsRevision}`;
  const delivering = run?.delivery.inProgress ?? false;
  const caps = capabilities(row, deliverable, delivering);
  const view = useGroupView(api, runId, row.slug, version, onError);
  const { busy, act } = useGroupAct(onError);
  const tabs = useGroupTabs({
    api,
    runId,
    row,
    version,
    view,
    caps,
    hasAttachments: (run?.attachments.length ?? 0) > 0,
    addressTab: props.tab ?? null,
    onAddressTab: props.onTab,
    onError,
  });
  const title = 'kind' in row && row.kind !== 'action' ? t(`runs.system.${row.kind}`) : row.title;
  const commands = useGroupCommands({ api, runId, row, run, title, act });
  const watch = useFollowEnd(section);
  const stopWatch = watch.stop;
  useEffect(() => {
    if (tabs.tab !== 'log') stopWatch();
  }, [tabs.tab, stopWatch]);
  const [forcing, setForcing] = useState(false);
  const [messaging, setMessaging] = useState<number | null>(null);
  return {
    ...props,
    showUsage,
    deliverable,
    onlyReplies: props.onlyReplies ?? false,
    view,
    busy,
    act,
    caps,
    delivering,
    title,
    tabs,
    watch,
    ...commands,
    skip: useGroupSkip(run, api, row, onError),
    statusesMounted: useStatusesMounted(showUsage),
    forcing,
    setForcing,
    messaging,
    setMessaging,
  };
}

export type GroupCtx = ReturnType<typeof useGroupCtx>;
