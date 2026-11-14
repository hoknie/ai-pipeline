import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../../shared/api/api.ts';
import { useConfirm } from '../../../../shared/ui/overlays/confirm.tsx';
import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import type { GroupRow, GroupView, RunView, SystemStepRow } from '../../../../shared/api/types.ts';
import { stepOfGroup, useSkipStep } from '../../header/skipStep.tsx';
import { taskProgress } from '../taskProgress.ts';
import { useGroupSpec } from '../useGroupSpec.ts';
import type { Capabilities } from './capabilities.ts';

type Row = GroupRow | SystemStepRow;

/** The group as the daemon describes it, loaded again when the row changes. */
export function useGroupView(
  api: Api,
  runId: string,
  slug: string,
  version: string,
  onError: (message: string) => void,
): GroupView | null {
  const [view, setView] = useState<GroupView | null>(null);
  useEffect(() => {
    let stopped = false;
    api.group(runId, slug).then(
      (next) => !stopped && setView(next),
      (failure: Error) => !stopped && onError(failure.message),
    );
    return () => {
      stopped = true;
    };
  }, [api, runId, slug, version, onError]);
  return view;
}

/** A request on the group: the buttons wait for it, a failure goes to the page. */
export function useGroupAct(onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await work();
      after?.();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

/** The statuses stay in the DOM while the header collapses, so the collapse is animated too. */
export function useStatusesMounted(showUsage: boolean): boolean {
  const [mounted, setMounted] = useState(showUsage);
  useEffect(() => {
    if (showUsage) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), 250);
    return () => clearTimeout(timer);
  }, [showUsage]);
  return mounted;
}

type Tab = 'log' | 'changes' | 'task' | 'design' | 'tasks' | 'artifacts' | 'attachments';

/** The open tab and the tabs the group has; the spec tabs appear when the group has a spec. */
export function useGroupTabs(args: {
  api: Api;
  runId: string;
  row: Row;
  version: string;
  view: GroupView | null;
  caps: Capabilities;
  /** The run has attachments: the tab of them exists. */
  hasAttachments: boolean;
  addressTab: string | null;
  onAddressTab: ((tab: string) => void) | undefined;
  onError: (message: string) => void;
}) {
  const { api, runId, row, version, view, caps, hasAttachments } = args;
  const { addressTab, onAddressTab, onError } = args;
  // without a controlling parent the screen keeps its tab itself
  const [localTab, setLocalTab] = useState<string | null>(null);
  const requestedTab = onAddressTab ? addressTab : localTab;
  const onTab = onAddressTab ?? setLocalTab;
  const active = !['merged', 'done', 'failed', 'cancelled'].includes(row.status);
  const system = 'kind' in row;
  const spec = useGroupSpec(
    api,
    runId,
    row.slug,
    version,
    active && (requestedTab === 'design' || requestedTab === 'tasks'),
    onError,
    !system,
  );
  const available = new Set<string>(['log', 'task']);
  if (caps.changes) available.add('changes');
  if (spec?.design != null) available.add('design');
  if (spec?.tasks != null) available.add('tasks');
  if (row.artifacts > 0) available.add('artifacts');
  if (hasAttachments) available.add('attachments');
  const loaded = view !== null && (system || spec !== undefined);
  const tab = (available.has(requestedTab ?? 'log') ? (requestedTab ?? 'log') : 'log') as Tab;
  useEffect(() => {
    if (loaded && requestedTab !== null && !available.has(requestedTab)) onTab('log');
  });
  const progress = spec?.tasks != null ? taskProgress(spec.tasks) : null;
  return { tab, setTab: (next: string) => onTab(next), spec, progress };
}

/** Skipping the step of the group in the pipeline of the run. */
export function useGroupSkip(
  run: RunView | undefined,
  api: Api,
  row: Row,
  onError: (m: string) => void,
) {
  const skipper = useSkipStep(run, api, onError);
  const skippable = run && !('kind' in row) ? stepOfGroup(run, row.slug) : null;
  const skipState = skippable ? run?.steps?.find((step) => step.id === skippable) : undefined;
  const canSkip = !!run && !!skipState && skipState.state !== 'done' && !skipState.skipped;
  return { skipper, skippable, canSkip };
}

/** Cancelling the group and marking its delivery as done, each after a confirmation. */
export function useGroupCommands(args: {
  api: Api;
  runId: string;
  row: Row;
  run: RunView | undefined;
  title: string;
  act: (work: () => Promise<unknown>, after?: () => void) => Promise<void>;
}) {
  const { api, runId, row, run, title, act } = args;
  const { t } = useTranslation();
  const confirm = useConfirm();
  const cancelGroup = async () => {
    const yes = await confirm({
      title: t('runs.group.cancelTitle', { title }),
      description: t('runs.group.cancelDescription'),
      confirmLabel: t('runs.group.cancelGroup'),
      cancelLabel: t('runs.header.keep'),
      destructive: true,
    });
    if (yes)
      await act(
        () => api.cancel(runId, row.slug),
        () => notifySuccess(t('runs.group.cancelled')),
      );
  };
  const markDelivered = async () => {
    if (!run) return;
    const yes = await confirm({
      title: t('runs.system.markDeliveredTitle', { title }),
      description: t('runs.header.markDeliveredConfirm'),
      confirmLabel: t('runs.header.markDeliveredAction'),
      cancelLabel: t('runs.header.markDeliveredKeep'),
    });
    if (yes)
      await act(
        () => api.markDelivered(run.id, [row.slug]),
        () => notifySuccess(t('runs.header.markedDelivered')),
      );
  };
  return { cancelGroup, markDelivered };
}
