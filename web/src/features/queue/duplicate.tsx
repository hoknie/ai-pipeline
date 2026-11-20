import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../../shared/api/http.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';

import type { QueueDraft } from './draft.ts';

/** The `code` of the answer of the panel to a task whose copy already waits in the queue. */
const DUPLICATE_TASK = 'duplicate_task';

/** What makes a draft the same task for the queue: a change of any of it is another task. */
function identityOf(draft: QueueDraft): string {
  const content = draft.mode === 'groups' ? draft.groups : draft.task.trim();
  return JSON.stringify([draft.pipeline, draft.variant, draft.provider, draft.mode, content]);
}

export interface DuplicateRefusal {
  /** The number of the waiting task (`#12`); null when the answer names none. */
  number: string | null;
  /** The text of the refusal as the daemon gave it. */
  message: string;
  /** Whether the refused attempt was "add and continue". */
  keep: boolean;
}

/**
 * The refusal of a copy of a waiting task, kept while the draft is still that task: changing the
 * pipeline, the variant, the provider, the text or the groups forgets it.
 */
export function useDuplicateRefusal(draft: QueueDraft) {
  const [refused, setRefused] = useState<(DuplicateRefusal & { identity: string }) | null>(null);
  const identity = identityOf(draft);
  return {
    refusal: refused !== null && refused.identity === identity ? refused : null,
    clear: () => setRefused(null),
    /** Takes the failure of a submit; true when it is the refusal of a copy. */
    take(failure: unknown, keep: boolean): boolean {
      if (!(failure instanceof ApiError) || failure.code !== DUPLICATE_TASK) return false;
      const number = /task (#\d+)/.exec(failure.message)?.[1] ?? null;
      setRefused({ number, message: failure.message, keep, identity });
      return true;
    },
  };
}

/** The refusal next to the form, with the way to add the copy all the same. */
export function DuplicateNotice({
  refusal,
  busy,
  onAddAnyway,
}: {
  refusal: DuplicateRefusal;
  busy: boolean;
  onAddAnyway: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive" data-duplicate-task={refusal.number ?? ''}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span title={refusal.message}>
          {refusal.number === null
            ? t('queue.form.duplicateUnknown')
            : t('queue.form.duplicate', { number: refusal.number })}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAddAnyway}>
          {t('queue.form.addAnyway')}
        </Button>
      </div>
    </Alert>
  );
}
