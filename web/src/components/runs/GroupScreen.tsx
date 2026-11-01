import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { useConfirm } from '../../confirm.tsx';
import { diffText, duration } from '../../format.ts';
import { notifySuccess } from '../../notify.ts';
import type { GroupRow, GroupView } from '../../types.ts';
import { Alert } from '../../ui/alert.tsx';
import { Button } from '../../ui/button.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Label } from '../../ui/label.tsx';
import { Skeleton } from '../../ui/skeleton.tsx';
import { Switch } from '../../ui/switch.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs.tsx';
import { Markdown } from '../Markdown.tsx';
import { OutsideChanges } from '../OutsideChanges.tsx';
import { StatusBadge } from '../StatusBadge.tsx';

import { AttemptTimeline } from './AttemptTimeline.tsx';
import { FileTree } from './FileTree.tsx';
import { QuestionCard } from './QuestionCard.tsx';
import { QuestionsForm } from './QuestionsForm.tsx';

type Tab = 'log' | 'changes' | 'task';

export function GroupScreen({
  api,
  runId,
  row,
  openStep = null,
  draftKey,
  drafts,
  onDraft,
  onClearDrafts,
  onError,
  onlyReplies = false,
  onOnlyReplies,
}: {
  api: Api;
  runId: string;
  row: GroupRow;
  /** Open the last attempt of this step instead of the last attempt of the group. */
  openStep?: string | null;
  /** Prefix of the keys of the drafts of this group: `<run>/<group>`. */
  draftKey: string;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onError: (message: string) => void;
  /** Show only the texts of the specialist in every log. */
  onlyReplies?: boolean;
  onOnlyReplies?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [view, setView] = useState<GroupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('log');
  const version = `${row.status}/${row.step}/${row.round}/${row.diff?.added ?? ''}/${row.delivery}`;

  useEffect(() => {
    let stopped = false;
    api.group(runId, row.slug).then(
      (next) => !stopped && setView(next),
      (failure: Error) => !stopped && onError(failure.message),
    );
    return () => {
      stopped = true;
    };
  }, [api, runId, row.slug, version, onError]);

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

  const canCancel = !['merged', 'failed', 'cancelled'].includes(row.status);
  const canRetry = ['failed', 'cancelled', 'conflict'].includes(row.status);
  const lastSeq = view?.attempts.at(-1)?.seq ?? null;
  const openSeq =
    (openStep ? view?.attempts.findLast((attempt) => attempt.stepId === openStep)?.seq : null) ??
    lastSeq;
  const cancelGroup = async () => {
    const yes = await confirm({
      title: t('runs.group.cancelTitle', { title: row.title }),
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
  const hints = view?.permissionHints ?? [];

  return (
    <section
      aria-label={t('runs.group.label', { title: row.title })}
      className="flex flex-col gap-3 p-4"
    >
      <header className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold" title={row.title}>
            {row.title}
          </h2>
          <StatusBadge status={row.status} />
          {canRetry ? (
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() =>
                void act(
                  () => api.retry(runId, row.slug),
                  () => notifySuccess(t('runs.header.retryStarted')),
                )
              }
            >
              <RotateCcw />
              {t('runs.group.retry')}
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              variant="destructive"
              size="sm"
              loading={busy}
              onClick={() => void cancelGroup()}
            >
              {t('runs.group.cancelGroup')}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{row.step ?? '—'}</span>
          {row.round !== null ? <span>{t('runs.group.round', { round: row.round })}</span> : null}
          <span>{duration(row.durationMs)}</span>
          {row.diff ? <span>{diffText(row.diff, t)}</span> : null}
          {row.status === 'merged' ? <StatusBadge status={row.delivery} /> : null}
        </div>
      </header>

      {row.reason && row.status !== 'needs_human' ? (
        <Alert variant="destructive">{row.reason}</Alert>
      ) : null}
      {row.status === 'needs_human' ? (
        row.questions && row.questions.length > 0 ? (
          <QuestionsForm
            questions={row.questions}
            draftKey={draftKey}
            drafts={drafts}
            busy={busy}
            onDraft={onDraft}
            onClearDrafts={onClearDrafts}
            onSubmit={(answer, done) => void act(() => api.answer(runId, row.slug, answer), done)}
          />
        ) : (
          <QuestionCard
            title={row.title}
            question={row.question}
            draft={drafts[draftKey] ?? ''}
            busy={busy}
            onDraft={(text) => onDraft(draftKey, text)}
            onSubmit={(answer, done) => void act(() => api.answer(runId, row.slug, answer), done)}
          />
        )
      ) : null}
      {view?.warnings.map((warning) => (
        <Alert key={warning} variant="warn">
          {warning}
        </Alert>
      ))}
      {view?.attempts.map((attempt) => (
        <OutsideChanges key={attempt.seq} attempt={attempt} />
      ))}
      {hints.length > 0 ? (
        <section aria-label={t('runs.group.hintsLabel')}>
          <Alert variant="warn">
            <div className="mb-1 text-xs font-medium uppercase">{t('runs.group.hintsTitle')}</div>
            <p>
              {t('runs.group.hintsAdd')} <code>allow_commands</code>:{' '}
              {hints.map((pattern, index) => (
                <span key={pattern}>
                  {index > 0 ? ', ' : ''}
                  <code>{pattern}</code>
                </span>
              ))}
              {t('runs.group.hintsAfter')} <code>aip/specialists/</code>.
            </p>
          </Alert>
        </section>
      ) : null}

      {view === null ? (
        <div role="status" aria-label={t('runs.group.loading')} className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList aria-label={t('runs.group.tabs')}>
            <TabsTrigger value="log">{t('runs.group.log')}</TabsTrigger>
            <TabsTrigger value="changes">
              {t('runs.group.changes')}
              {view.diff ? ` · ${view.diff.files.length}` : ''}
            </TabsTrigger>
            <TabsTrigger value="task">{t('runs.group.task')}</TabsTrigger>
          </TabsList>
          <TabsContent value="log" className="flex flex-col gap-3">
            {onOnlyReplies ? (
              <div className="flex items-center gap-2">
                <Switch id="only-replies" checked={onlyReplies} onCheckedChange={onOnlyReplies} />
                <Label htmlFor="only-replies">{t('runs.group.onlyReplies')}</Label>
              </div>
            ) : null}
            <AttemptTimeline
              api={api}
              runId={runId}
              group={row.slug}
              attempts={view.attempts}
              openSeq={openSeq}
              lastSeq={lastSeq}
              rawLog={view.log ? view.log.lines : null}
              onlyReplies={onlyReplies}
              retryable={row.status === 'failed' || row.status === 'cancelled'}
              onRetry={() =>
                void act(
                  () => api.retry(runId, row.slug),
                  () => notifySuccess(t('runs.header.retryStarted')),
                )
              }
            />
          </TabsContent>
          <TabsContent value="changes">
            {view.diff && view.diff.files.length > 0 ? (
              <FileTree files={view.diff.files} />
            ) : (
              <Empty title={t('runs.group.noChanges')}>{t('runs.group.noChangesText')}</Empty>
            )}
          </TabsContent>
          <TabsContent value="task">
            <Markdown text={view.task} />
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}
