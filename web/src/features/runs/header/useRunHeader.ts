import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import { useTags } from '../../../shared/lib/catalog/tags.tsx';
import type { RunView, TagView } from '../../../shared/api/types.ts';
import { canDeliver } from './delivery.ts';

type OnError = (message: string) => void;

/** Pausing the run, continuing its queue item and putting it back into the queue. */
export function useRunHold(run: RunView, api: Api, onError: OnError) {
  const { t } = useTranslation();
  const [returning, setReturning] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [continuing, setContinuing] = useState(false);
  // The queue item the server answered a pause with: "Continue" shows at once, without the stream.
  const [pausedItem, setPausedItem] = useState<string | null>(null);
  useEffect(() => setPausedItem(null), [run.hold, run.queueItem]);
  const guarded = async (set: (on: boolean) => void, work: () => Promise<void>) => {
    set(true);
    try {
      await work();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      set(false);
    }
  };
  const putBack = () =>
    guarded(setReturning, async () => {
      await api.queueReturn(run.id, run.repository);
      notifySuccess(t('runs.header.returned'));
    });
  const pause = () =>
    guarded(setPausing, async () => {
      const answer = await api.pauseRun(run.id, run.repository);
      setPausedItem(answer.item);
      notifySuccess(t('runs.header.paused'));
    });
  const resume = (item: string) =>
    guarded(setContinuing, async () => {
      await api.forRepository(run.repository).queueRunNow(item);
      setPausedItem(null);
      notifySuccess(t('runs.header.continued'));
    });
  return {
    returning,
    pausing,
    continuing,
    putBack,
    pause,
    resume,
    continueItem: (run.hold !== null ? run.queueItem : null) ?? pausedItem,
    pausable: !run.finished && run.hold === null && run.queueItem === null && pausedItem === null,
  };
}

/** Taking the repair of the run from the observer, or giving it back. */
export function useRunObserver(run: RunView, api: Api) {
  const [observing, setObserving] = useState(false);
  const [observerError, setObserverError] = useState<string | null>(null);
  const setObserver = async (enabled: boolean) => {
    setObserving(true);
    setObserverError(null);
    try {
      await api.setRunObserver(run.id, run.repository, enabled);
    } catch (error) {
      setObserverError((error as Error).message);
    } finally {
      setObserving(false);
    }
  };
  return { observing, observerError, setObserver };
}

/** Changing the tags of the run; the tags go by name. */
export function useRunTags(run: RunView, api: Api) {
  const [tagging, setTagging] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const { byId } = useTags();
  const runTagIds = (run.tags ?? []).map((tag) => tag.id);
  const changeTags = async (ids: string[], fresh?: TagView[]) => {
    const lookup = fresh ? new Map(fresh.map((tag) => [tag.id, tag])) : byId;
    const names = (list: string[]) =>
      list.flatMap((id) => {
        const tag = lookup.get(id);
        return tag && !tag.task ? tag.name : [];
      });
    const add = names(ids.filter((id) => !runTagIds.includes(id)));
    const remove = names(runTagIds.filter((id) => !ids.includes(id)));
    if (add.length === 0 && remove.length === 0) return;
    setTagging(true);
    setTagError(null);
    try {
      await api.setRunTags(run.id, {
        ...(add.length > 0 ? { add } : {}),
        ...(remove.length > 0 ? { remove } : {}),
      });
    } catch (error) {
      setTagError((error as Error).message);
    } finally {
      setTagging(false);
    }
  };
  return { tagging, tagError, runTagIds, changeTags };
}

const retryable = (status: string) => status === 'failed' || status === 'cancelled';

/** Retrying every failed or cancelled group of the run, with or without a fresh configuration. */
export function useRetryFailed(run: RunView, api: Api, onError: OnError) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState<'plain' | 'refresh' | null>(null);
  const failed: { slug: string; title: string; status: string }[] = run.groups.filter((group) =>
    retryable(group.status),
  );
  if (run.split && retryable(run.split.status)) {
    failed.unshift({ slug: '_split', title: t('runs.header.split'), status: run.split.status });
  }
  const hasCancelled = failed.some((group) => group.status === 'cancelled');
  const retryFailed = async (refreshConfig: boolean) => {
    setRetrying(refreshConfig ? 'refresh' : 'plain');
    const refused: string[] = [];
    for (const group of failed) {
      try {
        if (refreshConfig) await api.retry(run.id, group.slug, { refreshConfig: true });
        else await api.retry(run.id, group.slug);
      } catch (error) {
        refused.push(`${group.title}: ${(error as Error).message}`);
      }
    }
    setRetrying(null);
    if (refused.length > 0) onError(t('runs.header.retryRefused', { list: refused.join('; ') }));
    else notifySuccess(t('runs.header.retryStarted'));
  };
  return { failed, hasCancelled, retrying, retryFailed };
}

/** Delivering the run, by force and without, and marking it delivered. */
export function useRunDelivery(
  run: RunView,
  api: Api,
  onError: OnError,
  onDeliver: ((force: boolean) => Promise<unknown>) | undefined,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [forcing, setForcing] = useState(false);
  const [applying, setApplying] = useState(false);
  const markDelivered = async () => {
    const yes = await confirm({
      title: t('runs.header.markDeliveredTitle'),
      description: t('runs.header.markDeliveredConfirm'),
      confirmLabel: t('runs.header.markDeliveredAction'),
      cancelLabel: t('runs.header.markDeliveredKeep'),
    });
    if (!yes) return;
    try {
      await api.markDelivered(run.id);
      notifySuccess(t('runs.header.markedDelivered'));
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const apply = async (force: boolean) => {
    setForcing(false);
    setApplying(true);
    try {
      await (onDeliver ? onDeliver(force) : api.apply(run.id, force));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setApplying(false);
    }
  };
  return { forcing, setForcing, applying, apply, markDelivered, deliverable: canDeliver(run) };
}
