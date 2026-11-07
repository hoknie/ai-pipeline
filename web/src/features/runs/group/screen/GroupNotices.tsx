import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { reasonLabel } from '../../../../shared/lib/format.ts';
import { notifySuccess } from '../../../../shared/lib/browser/notify.ts';
import type { GroupRow } from '../../../../shared/api/types.ts';
import { Alert } from '../../../../shared/ui/feedback/alert.tsx';
import { Badge } from '../../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../../shared/ui/forms/button.tsx';
import { FilePath } from '../../../../shared/ui/layout/FilePath.tsx';
import { OutsideChanges } from '../OutsideChanges.tsx';
import { QuestionCard } from '../QuestionCard.tsx';
import { QuestionsForm } from '../QuestionsForm.tsx';
import { groupNotices, latestNotice, useDismissedNotice } from '../groupNotices.ts';
import type { GroupCtx } from './useGroupCtx.ts';

/** A group that only a person can move on: the kind of the wait and, for a review, «Accept». */
function HumanOnly({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const { api, runId, row, busy, act } = ctx;
  if (row.status !== 'needs_human' || !row.humanOnly) return null;
  return (
    <section
      aria-label={t(`runs.humanOnly.${row.humanOnly}`)}
      className="flex flex-wrap items-center gap-2"
    >
      <Badge variant="warn">{t(`runs.humanOnly.${row.humanOnly}`)}</Badge>
      <span className="text-xs text-muted-foreground">{t('runs.humanOnly.hint')}</span>
      {row.humanOnly === 'review' ? (
        <Button
          size="sm"
          loading={busy}
          onClick={() =>
            void act(
              () => api.answer(runId, row.slug, 'Принято'),
              () => notifySuccess(t('runs.questions.answerSent')),
            )
          }
        >
          {t('runs.humanOnly.accept')}
        </Button>
      ) : null}
    </section>
  );
}

/** The questions of the specialist and the form to answer them. */
function Questions({ ctx }: { ctx: GroupCtx }) {
  const { api, runId, row, busy, act, drafts, draftKey, onDraft } = ctx;
  if (row.status !== 'needs_human') return null;
  const send = (answer: string, done?: () => void) =>
    void act(() => api.answer(runId, row.slug, answer), done);
  return row.questions && row.questions.length > 0 ? (
    <QuestionsForm
      questions={row.questions}
      draftKey={draftKey}
      drafts={drafts}
      busy={busy}
      onDraft={onDraft}
      onClearDrafts={ctx.onClearDrafts}
      onSubmit={send}
    />
  ) : (
    <QuestionCard
      title={ctx.title}
      question={row.question}
      draft={drafts[draftKey] ?? ''}
      busy={busy}
      onDraft={(text) => onDraft(draftKey, text)}
      onSubmit={send}
    />
  );
}

/** The latest notice of the group: outside changes, hints for `allow_commands`, a reason. */
function Notice({ ctx }: { ctx: GroupCtx }) {
  const { t } = useTranslation();
  const [dismissed, dismiss] = useDismissedNotice(ctx.runId, ctx.row.slug);
  const notice = latestNotice(groupNotices(ctx.view, ctx.row as GroupRow), dismissed);
  if (!notice) return null;
  if (notice.kind === 'outside')
    return <OutsideChanges attempt={notice.attempt} onDismiss={() => dismiss(notice.key)} />;
  const closeButton = (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-1 right-1 size-7"
      aria-label={t('runs.group.dismissNotice')}
      title={t('runs.group.dismissNotice')}
      onClick={() => dismiss(notice.key)}
    >
      <X />
    </Button>
  );
  if (notice.kind === 'hints') {
    return (
      <section aria-label={t('runs.group.hintsLabel')}>
        <Alert variant="warn" className="relative pr-10">
          {closeButton}
          <div className="mb-1 text-xs font-medium uppercase">{t('runs.group.hintsTitle')}</div>
          <p>
            {t('runs.group.hintsAdd')} <code>allow_commands</code>:{' '}
            {notice.patterns.map((pattern, index) => (
              <span key={pattern}>
                {index > 0 ? ', ' : ''}
                <code>{pattern}</code>
              </span>
            ))}
            {t('runs.group.hintsAfter')} <FilePath path="aip/specialists/" />.
          </p>
        </Alert>
      </section>
    );
  }
  return (
    <Alert variant={notice.kind === 'reason' ? 'destructive' : 'warn'} className="relative pr-10">
      {closeButton}
      {notice.kind === 'reason' ? reasonLabel(notice.text, t) : notice.text}
    </Alert>
  );
}

/** What waits for a person above the tabs of the group. */
export function GroupNotices({ ctx }: { ctx: GroupCtx }) {
  return (
    <>
      <HumanOnly ctx={ctx} />
      <Questions ctx={ctx} />
      <Notice ctx={ctx} />
    </>
  );
}
