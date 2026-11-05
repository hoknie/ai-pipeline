import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { clockSeconds, cost, dateTime, tokens } from '../format.ts';
import { cn } from '../lib/cn.ts';
import type { TranscriptEntry } from '../types.ts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx';

import { isJsonSummary, parseJson, readableJson, readableSummary } from './jsonText.ts';
import { Markdown } from './Markdown.tsx';
import { StatusBadge } from './StatusBadge.tsx';

type ToolCall = Extract<TranscriptEntry, { kind: 'tool_call' }>;
type ToolResult = Extract<TranscriptEntry, { kind: 'tool_result' }>;

type Block =
  | { kind: 'call'; call: ToolCall; results: ToolResult[] }
  | { kind: 'entry'; entry: TranscriptEntry };

/** Puts every tool result under the call it answers. */
export function blocks(entries: TranscriptEntry[]): Block[] {
  const result: Block[] = [];
  const calls = new Map<string, Block & { kind: 'call' }>();
  for (const entry of entries) {
    if (entry.kind === 'tool_call') {
      const block = { kind: 'call' as const, call: entry, results: [] as ToolResult[] };
      if (entry.id) calls.set(entry.id, block);
      result.push(block);
    } else if (entry.kind === 'tool_result' && entry.id && calls.has(entry.id)) {
      calls.get(entry.id)?.results.push(entry);
    } else {
      result.push({ kind: 'entry', entry });
    }
  }
  return result;
}

/** The moment of a log entry; nothing when the daemon did not send it. */
export function EntryTime({ at }: { at: number | null | undefined }) {
  const { i18n } = useTranslation();
  if (at === null || at === undefined) return null;
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={dateTime(at, i18n.language)}
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
    >
      {clockSeconds(at)}
    </time>
  );
}

function firstLine(text: string): string {
  const line = text.split('\n').find((part) => part.trim() !== '') ?? '';
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

function Fold({
  failed = false,
  head,
  at,
  children,
}: {
  failed?: boolean;
  head: React.ReactNode;
  at?: number | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      className={cn('rounded-md border text-sm', failed && 'border-status-err/30 bg-status-err-bg')}
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-2 py-1 text-left">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        {head}
        <span className="ml-auto" />
        <EntryTime at={at} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-96 overflow-auto px-3 pb-2 font-mono text-xs whitespace-pre-wrap">
          {children}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Result({ result, showJson }: { result: ToolResult; showJson: boolean }) {
  const { t } = useTranslation();
  const value = showJson ? undefined : parseJson(result.text);
  const text = value === undefined ? result.text : readableJson(value);
  if (result.error) {
    return (
      <Fold
        failed
        head={
          <span className="min-w-0 truncate">
            <span className="font-medium text-status-err">{t('runs.transcript.error')}</span>{' '}
            {firstLine(text)}
          </span>
        }
        at={result.at}
      >
        {text}
      </Fold>
    );
  }
  return (
    <Fold
      head={
        <span className="truncate">
          {t('runs.transcript.result')} · {firstLine(text) || t('runs.transcript.emptyResult')}
        </span>
      }
      at={result.at}
    >
      {text}
    </Fold>
  );
}

function Call({
  call,
  results,
  showJson,
}: {
  call: ToolCall;
  results: ToolResult[];
  showJson: boolean;
}) {
  const input = showJson ? undefined : parseJson(call.input);
  const summary =
    input !== undefined && isJsonSummary(call.summary, call.input)
      ? readableSummary(input)
      : call.summary;
  return (
    <div className="flex flex-col gap-1">
      <Fold
        head={
          <>
            <span className="font-medium">{call.name}</span>
            <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
              {summary}
            </code>
          </>
        }
        at={call.at}
      >
        {input === undefined ? call.input : readableJson(input)}
      </Fold>
      {results.map((result, index) => (
        <div key={index} className="ml-4">
          <Result result={result} showJson={showJson} />
        </div>
      ))}
    </div>
  );
}

function Entry({ entry, showJson }: { entry: TranscriptEntry; showJson: boolean }) {
  const { t } = useTranslation();
  switch (entry.kind) {
    case 'text':
      return (
        <section
          aria-label={t('runs.transcript.textLabel')}
          className="rounded-lg border bg-card p-3"
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground uppercase">
            <span>{t('runs.transcript.specialist')}</span>
            <EntryTime at={entry.at} />
          </div>
          <Markdown text={entry.text} />
        </section>
      );
    case 'tool_call':
      return <Call call={entry} results={[]} showJson={showJson} />;
    case 'tool_result':
      return <Result result={entry} showJson={showJson} />;
    case 'result':
      return (
        <div
          className={cn(
            'flex items-center gap-2 text-xs text-muted-foreground',
            entry.error && 'text-status-err',
          )}
        >
          {entry.verdict ? (
            <StatusBadge status={entry.verdict === 'done' ? 'done' : 'needs_human'} />
          ) : null}
          <span>
            {t('runs.transcript.usage', {
              input: tokens(entry.inputTokens),
              output: tokens(entry.outputTokens),
            })}{' '}
            {cost(entry)}
          </span>
          <EntryTime at={entry.at} />
        </div>
      );
    case 'raw':
      if (!showJson && parseJson(entry.text) !== undefined) return null;
      return <pre className="font-mono text-xs whitespace-pre-wrap">{entry.text}</pre>;
  }
}

export function Transcript({
  entries,
  onlyText = false,
  showJson = true,
}: {
  entries: TranscriptEntry[];
  /** Shows only the specialist's own messages. */
  onlyText?: boolean;
  /** Shows inputs, results and unknown lines as JSON; off renders `key: value` and hides the unknown lines. */
  showJson?: boolean;
}) {
  const { t } = useTranslation();
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground">{t('runs.transcript.empty')}</p>;
  const shown = onlyText ? entries.filter((entry) => entry.kind === 'text') : entries;
  if (shown.length === 0)
    return <p className="text-sm text-muted-foreground">{t('runs.transcript.noReplies')}</p>;
  return (
    <div className="flex flex-col gap-2">
      {blocks(shown).map((block, index) =>
        block.kind === 'call' ? (
          <Call key={index} call={block.call} results={block.results} showJson={showJson} />
        ) : (
          <Entry key={index} entry={block.entry} showJson={showJson} />
        ),
      )}
    </div>
  );
}
