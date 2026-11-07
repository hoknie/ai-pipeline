import type { Api } from '../../../shared/api/api.ts';
import type { AttemptView } from '../../../shared/api/types.ts';
import { useTranslation } from 'react-i18next';

import { Attempt } from './Attempt.tsx';

/** Attempts of a group as a vertical timeline. */
export function AttemptTimeline({
  api,
  runId,
  group,
  attempts,
  openSeq,
  lastSeq,
  rawLog,
  onlyReplies,
  showJson,
  retryable,
  onRetry,
  onMessage,
}: {
  api: Api;
  runId: string;
  group: string;
  attempts: AttemptView[];
  openSeq: number | null;
  lastSeq: number | null;
  rawLog: string[] | null;
  onlyReplies: boolean;
  showJson: boolean;
  /** The last attempt of a failed group can be retried. */
  retryable: boolean;
  onRetry: () => void;
  /** Opens the message to the specialist; offered for the running last attempt. */
  onMessage?: () => void;
}) {
  const { t } = useTranslation();
  if (attempts.length === 0)
    return <p className="text-sm text-muted-foreground">{t('runs.attempt.none')}</p>;
  return (
    <ol aria-label={t('runs.attempt.list')} className="ml-1.5 flex flex-col gap-2 border-l pb-1">
      {attempts.map((attempt) => (
        <Attempt
          key={attempt.seq}
          api={api}
          runId={runId}
          group={group}
          attempt={attempt}
          initiallyOpen={attempt.seq === openSeq}
          rawLog={attempt.seq === lastSeq ? rawLog : null}
          onlyReplies={onlyReplies}
          showJson={showJson}
          {...(attempt.seq === lastSeq && retryable ? { onRetry } : {})}
          {...(attempt.seq === lastSeq &&
          onMessage &&
          attempt.status === 'running' &&
          attempt.verdict === null &&
          !attempt.interrupting
            ? { onMessage }
            : {})}
        />
      ))}
    </ol>
  );
}
