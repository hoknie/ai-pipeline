import { useTranslation } from 'react-i18next';
import type {
  HistoryResult,
  ObserverHistoryItem as Item,
} from '../../../../shared/api/observerHistoryApi.ts';
import { tokens } from '../../../../shared/lib/format.ts';
import { Badge } from '../../../../shared/ui/feedback/badge.tsx';
import { formatDuration, formatRunHref, formatTime, formatUsd } from './format.ts';

function resultVariant(result: HistoryResult) {
  if (result === 'running') return 'run';
  if (result === 'done') return 'ok';
  if (result === 'rejected' || result === 'needs_human') return 'warn';
  if (result === 'failed') return 'err';
  if (result === 'cancelled') return 'mute';
  return 'outline';
}

function usageInfo(item: Item) {
  if (!item.usage) return <span>—</span>;
  const exact = `${item.usage.inputTokens.toLocaleString()} / ${item.usage.outputTokens.toLocaleString()}`;
  return (
    <span title={exact}>
      {tokens(item.usage.inputTokens)} / {tokens(item.usage.outputTokens)} ·{' '}
      {formatUsd(item.usage.costUsd)}
    </span>
  );
}

export function HistoryItem({ item, asOf }: { item: Item; asOf: number }) {
  const { t } = useTranslation();
  return (
    <tr className="border-t">
      <td className="break-words p-2">
        <span className="mr-1 font-mono text-muted-foreground">#{item.runNumber}</span>
        <a className="underline focus-visible:outline" href={formatRunHref(item.runId)}>
          {item.runTitle || item.runId}
        </a>{' '}
        <span className="text-muted-foreground">#{item.attemptSeq}</span>
      </td>
      <td className="break-all p-2">{item.repository}</td>
      <td className="p-2">{item.runtime}</td>
      <td className="break-all p-2">{item.model ?? '—'}</td>
      <td className="p-2">
        <time title={formatTime(item.startedAt)}>{new Date(item.startedAt).toLocaleString()}</time>
        <div className="text-xs text-muted-foreground">
          {item.finishedAt ? (
            <time title={formatTime(item.finishedAt)}>
              {new Date(item.finishedAt).toLocaleString()}
            </time>
          ) : (
            '—'
          )}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {formatDuration(item.startedAt, item.finishedAt, asOf)}
        </div>
      </td>
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={resultVariant(item.result)}>
            {t(`observers.history.results.${item.result}` as never)}
          </Badge>
          {item.failureKind ? (
            <span className="text-xs text-muted-foreground" title={item.failureKind}>
              ({item.failureKind})
            </span>
          ) : null}
        </div>
      </td>
      <td className="p-2 tabular-nums">{usageInfo(item)}</td>
    </tr>
  );
}

export function HistoryCard({ item, asOf }: { item: Item; asOf: number }) {
  const { t } = useTranslation();
  return (
    <article className="min-w-0 rounded border p-3">
      <div className="mb-1">
        <span className="mr-1 font-mono text-muted-foreground">#{item.runNumber}</span>
        <a className="break-words underline focus-visible:outline" href={formatRunHref(item.runId)}>
          {item.runTitle || item.runId}
        </a>{' '}
        <span className="text-muted-foreground">#{item.attemptSeq}</span>
      </div>
      <p className="break-all text-xs text-muted-foreground">{item.repository}</p>
      <p className="text-xs">
        {item.runtime} · <span className="break-all">{item.model ?? '—'}</span>
      </p>
      <div className="my-1 text-xs">
        <time title={formatTime(item.startedAt)}>{new Date(item.startedAt).toLocaleString()}</time>
        {' → '}
        {item.finishedAt ? (
          <time title={formatTime(item.finishedAt)}>
            {new Date(item.finishedAt).toLocaleString()}
          </time>
        ) : (
          '—'
        )}
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {formatDuration(item.startedAt, item.finishedAt, asOf)}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <Badge variant={resultVariant(item.result)}>
            {t(`observers.history.results.${item.result}` as never)}
          </Badge>
          {item.failureKind ? (
            <span className="text-xs text-muted-foreground" title={item.failureKind}>
              ({item.failureKind})
            </span>
          ) : null}
        </div>
        <div className="tabular-nums text-xs">{usageInfo(item)}</div>
      </div>
    </article>
  );
}
