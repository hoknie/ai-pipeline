import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api, QueueSettingsPatch } from '../../../shared/api/api.ts';
import { notifySuccess } from '../../../shared/lib/browser/notify.ts';
import type { QueueView } from '../../../shared/api/types.ts';

export type QueueToggle = 'autopilot' | 'autoAnswer' | 'skipFailed';

/** The changes of the queue settings: each one waits for the daemon and a failure goes to the page. */
export function useQueueModes(
  api: Api,
  queue: QueueView,
  onQueue: (queue: QueueView) => void,
  onError: (message: string) => void,
) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Partial<Record<QueueToggle, boolean>>>({});
  const [answer, setAnswer] = useState<string | null>(null);
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [pendingLimit, setPendingLimit] = useState<'wait' | 'stop' | null>(null);

  const changeLimit = async (value: 'wait' | 'stop') => {
    if (value === queue.onLimit) return;
    setPendingLimit(value);
    try {
      onQueue(await api.queueSettings({ onLimit: value }));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPendingLimit(null);
    }
  };

  const toggle = async (key: QueueToggle, value: boolean) => {
    const patch: QueueSettingsPatch = { [key]: value };
    setPending((current) => ({ ...current, [key]: value }));
    try {
      onQueue(await api.queueSettings(patch));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setPending((current) => {
        const { [key]: _gone, ...rest } = current;
        return rest;
      });
    }
  };

  const shownAnswer = answer ?? queue.autopilotAnswer ?? queue.autopilotAnswerDefault;
  const saveAnswer = async (value: string | null) => {
    setSavingAnswer(true);
    try {
      onQueue(await api.queueSettings({ autopilotAnswer: value }));
      setAnswer(null);
      notifySuccess(t('queue.settings.autopilotAnswerSaved'));
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSavingAnswer(false);
    }
  };
  return {
    pending,
    answer,
    setAnswer,
    savingAnswer,
    pendingLimit,
    changeLimit,
    toggle,
    shownAnswer,
    saveAnswer,
  };
}

export type QueueModesState = ReturnType<typeof useQueueModes>;
