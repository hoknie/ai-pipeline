import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { QueueItemView, QueueView } from '../../../shared/api/types.ts';
import type { QueueDraft } from '../QueueForm.tsx';
import { dependents, unmet } from '../queueLinks.ts';
import { itemLabel } from './itemText.ts';
import type { QueueNotice } from './useQueueOrder.ts';

type EditFields = Parameters<
  Parameters<typeof import('../QueueForm.tsx').QueueForm>[0]['onSubmit']
>[0];

/** The body of an edit: a returned run keeps its task, only the predecessors can change. */
function editPayload(item: QueueItemView, fields: EditFields) {
  const after = fields.after !== undefined ? { after: fields.after } : {};
  if (item.run !== null) return after;
  return {
    pipeline: fields.pipeline,
    ...(fields.task !== undefined ? { task: fields.task } : {}),
    ...(fields.groups !== undefined ? { groups: fields.groups } : {}),
    title: fields.title ?? null,
    autoDeliver: fields.autoDeliver ?? null,
    deliveryMode: fields.deliveryMode ?? null,
    tags: fields.tags ?? [],
    skip: fields.skip ?? [],
    ...after,
    ...(fields.parent !== undefined ? { parent: fields.parent } : {}),
    ...(fields.uploads !== undefined ? { uploads: fields.uploads } : {}),
    ...(fields.detach !== undefined ? { detach: fields.detach } : {}),
  };
}

type Confirm = ReturnType<typeof useConfirm>;

/** Asks before starting an item whose predecessors are not done. */
async function confirmUnmet(confirm: Confirm, t: TFunction, item: QueueItemView): Promise<boolean> {
  if (item.readiness === 'ready' || item.hold !== null) return true;
  return confirm({
    title: t('queue.list.unmetTitle'),
    description: t('queue.list.unmetText', {
      items: unmet(item)
        .map((ref) => ref.title || ref.id)
        .join(', '),
    }),
    confirmLabel: t('queue.list.runNow'),
    cancelLabel: t('queue.list.keep'),
  });
}

/** Removing, starting, postponing and editing an item; the failures go to the shared notice. */
export function useQueueActions(
  api: Api,
  queue: QueueView,
  onQueue: (queue: QueueView) => void,
  onDraft: (key: string, draft: QueueDraft | null) => void,
  notice: QueueNotice,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { setMessage, refresh } = notice;
  const [started, setStarted] = useState<{ item: string; runId: string } | null>(null);
  // the shown state of the buttons while their request is on its way
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const fail = (failure: unknown) => {
    setMessage((failure as Error).message);
    void refresh();
  };

  const remove = async (item: QueueItemView) => {
    const waiting = dependents(queue, item.id);
    const yes = await confirm({
      title: t('queue.list.removeTitle', { item: itemLabel(item, t) }),
      ...(waiting.length > 0
        ? {
            description: t('queue.list.removeDependents', {
              items: waiting.map((other) => itemLabel(other, t)).join(', '),
            }),
          }
        : {}),
      confirmLabel: t('queue.list.remove'),
      cancelLabel: t('queue.list.keep'),
      destructive: true,
    });
    if (!yes) return;
    setMessage(null);
    try {
      onQueue(await api.queueRemove(item.id));
      onDraft(`edit:${item.id}`, null);
      notifySuccess(t('queue.list.removed'));
    } catch (failure) {
      fail(failure);
    }
  };

  const runNow = async (item: QueueItemView) => {
    if (!(await confirmUnmet(confirm, t, item))) return;
    setMessage(null);
    try {
      const created = await api.queueRunNow(item.id);
      setStarted({ item: item.id, runId: created.runId });
      notifySuccess(t('queue.list.runStarted'));
      onDraft(`edit:${item.id}`, null);
      await refresh();
    } catch (failure) {
      fail(failure);
    }
  };

  const setPostponed = async (item: QueueItemView, postponed: boolean) => {
    setPending((current) => ({ ...current, [item.id]: postponed }));
    setMessage(null);
    try {
      onQueue(await api.queueEdit(item.id, { postponed }));
    } catch (failure) {
      fail(failure);
    } finally {
      setPending((current) => {
        const { [item.id]: _shown, ...rest } = current;
        return rest;
      });
    }
  };

  const edit = async (item: QueueItemView, fields: EditFields) => {
    try {
      const view = await api.queueEdit(item.id, editPayload(item, fields));
      onQueue(view);
      onDraft(`edit:${item.id}`, null);
    } catch (failure) {
      // the item became a run: the form goes away with it, so the error stays here
      if (/unknown queue item/.test((failure as Error).message)) fail(failure);
      throw failure;
    }
  };
  return { started, pending, remove, runNow, setPostponed, edit };
}
