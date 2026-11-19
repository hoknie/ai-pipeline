import { ChevronRight, MessageSquare, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { liveTopics } from '../../../shared/api/live/topics.ts';
import { clockSeconds, dateTime, duration, tokens } from '../../../shared/lib/format.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { statusTone, type Tone } from '../../../shared/lib/status.ts';
import type { AttemptView, TranscriptEntry } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../shared/ui/layout/collapsible.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { authorOf } from '../../../shared/api/observerTypes.ts';
import { Markdown } from '../../../shared/ui/layout/Markdown.tsx';
import { StatusBadge } from '../../../shared/ui/feedback/StatusBadge.tsx';
import { AttemptActions, AttemptBody, AttemptHeading } from './AttemptParts.tsx';

interface Loaded {
  cursor: number;
  running: boolean;
  entries: TranscriptEntry[];
}

/**
 * Transcript of one attempt, watched while `active`: the parts of a running attempt come as its
 * log grows.
 */
function useTranscript(
  api: Api,
  runId: string,
  group: string,
  seq: number,
  active: boolean,
): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = useRef<Loaded | null>(null);
  useEffect(() => {
    const before = current.current;
    if (!active || (before && !before.running)) return;
    const topic = { kind: 'transcript' as const, runId, group, seq, after: before?.cursor ?? 0 };
    return liveTopics.watch(api, topic, (next) => {
      const merged: Loaded = {
        cursor: next.cursor,
        running: next.running,
        entries: [...(current.current?.entries ?? []), ...next.entries],
      };
      current.current = merged;
      setLoaded(merged);
    });
  }, [api, runId, group, seq, active]);
  return loaded;
}

const DOT: Record<Tone, string> = {
  run: 'bg-status-run',
  warn: 'bg-status-warn',
  err: 'bg-status-err',
  ok: 'bg-status-ok',
  mute: 'bg-status-mute',
};

export function Attempt({
  api,
  runId,
  group,
  attempt,
  initiallyOpen,
  rawLog,
  onlyReplies = false,
  showJson = false,
  onRetry,
  onMessage,
}: {
  api: Api;
  runId: string;
  group: string;
  attempt: AttemptView;
  initiallyOpen: boolean;
  /** Raw lines of the log, known for the last attempt only. */
  rawLog: string[] | null;
  /** Show only the texts of the specialist in the transcript; one switch for the whole run. */
  onlyReplies?: boolean;
  /** Show JSON in the transcript as it is; one switch for the whole run. */
  showJson?: boolean;
  /** Retries the step; given for the last attempt of a failed group only. */
  onRetry?: () => void;
  /** Opens the message to the specialist; given for the running last attempt only. */
  onMessage?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const [raw, setRaw] = useState(false);
  const transcript = useTranscript(api, runId, group, attempt.seq, open);
  const verdict = attempt.verdict ?? attempt.status;
  return (
    <li className="relative pl-6">
      <span
        aria-hidden
        className={cn(
          'absolute top-3.5 left-0 size-3 -translate-x-1/2 rounded-full ring-4 ring-background',
          DOT[statusTone(verdict)],
        )}
      />
      <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
        <div className="sticky top-[var(--group-header-height,0px)] z-[5] flex items-center gap-2 rounded-t-lg bg-card pr-2">
          <CollapsibleTrigger
            aria-label={t('runs.attempt.label', {
              seq: attempt.seq,
              step: attempt.stepName ?? attempt.stepId,
            })}
            className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm"
          >
            <AttemptHeading attempt={attempt} verdict={verdict} />
          </CollapsibleTrigger>
          <AttemptActions attempt={attempt} onMessage={onMessage} onRetry={onRetry} />
        </div>
        <CollapsibleContent>
          {open ? (
            <AttemptBody
              attempt={attempt}
              rawLog={rawLog}
              transcript={transcript}
              onlyReplies={onlyReplies}
              showJson={showJson}
              raw={raw}
              onRaw={setRaw}
            />
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
