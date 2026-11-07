import { useCallback, useState } from 'react';

import type { QueueDraft } from '../../features/queue/index.ts';

/** Unsent texts of the run forms and the drafts of queue tasks, kept while the panel is open. */
export function useDrafts() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [queueDrafts, setQueueDrafts] = useState<Record<string, QueueDraft>>({});
  const onDraft = useCallback((key: string, text: string) => {
    setDrafts((current) => ({ ...current, [key]: text }));
  }, []);
  const onClearDrafts = useCallback((prefix: string) => {
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== prefix && !key.startsWith(`${prefix}/`)),
      ),
    );
  }, []);
  const onQueueDraft = useCallback((key: string, draft: QueueDraft | null) => {
    setQueueDrafts((current) => {
      if (draft !== null) return { ...current, [key]: draft };
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }, []);
  return { drafts, queueDrafts, onDraft, onClearDrafts, onQueueDraft };
}
