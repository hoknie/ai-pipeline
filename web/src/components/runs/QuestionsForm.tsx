import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { answerText, questionKey, type AskedQuestion } from '../../format.ts';
import { notifySuccess } from '../../notify.ts';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import { Markdown } from '../Markdown.tsx';

/** The form for structured questions: options, a recommended answer and one field per question. */
export function QuestionsForm({
  questions,
  draftKey,
  drafts,
  busy,
  onDraft,
  onClearDrafts,
  onSubmit,
}: {
  questions: readonly AskedQuestion[];
  draftKey: string;
  drafts: Record<string, string>;
  busy: boolean;
  onDraft: (key: string, text: string) => void;
  onClearDrafts: (prefix: string) => void;
  onSubmit: (answer: string, done: () => void) => void;
}) {
  const { t } = useTranslation();
  const keys = questions.map((question, index) => questionKey(draftKey, index, question.text));
  const values = questions.map(
    (question, index) => drafts[keys[index]!] ?? question.recommendation ?? '',
  );
  const empty = values.filter((value) => value.trim() === '').length;
  return (
    <form
      aria-label={t('runs.questions.label')}
      className="flex flex-col gap-3 rounded-lg border border-status-warn/40 bg-status-warn-bg p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (empty > 0) return;
        onSubmit(answerText(questions, values), () => {
          onClearDrafts(draftKey);
          notifySuccess(t('runs.questions.answerSent'));
        });
      }}
    >
      <h3 className="text-sm font-semibold text-status-warn">
        {t('runs.questions.heading', { n: questions.length })}
      </h3>
      {questions.map((question, index) => {
        const options = question.options ?? [];
        const recommendation = question.recommendation ?? null;
        return (
          <fieldset key={keys[index]} className="flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
              {t('runs.questions.question', { index: index + 1, total: questions.length })}
            </legend>
            <Markdown text={question.text} />
            {options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                  <Button
                    key={option}
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-7 whitespace-normal"
                    aria-pressed={values[index] === option}
                    onClick={() => onDraft(keys[index]!, option)}
                  >
                    {option}
                    {option === recommendation ? (
                      <Badge variant="warn">
                        <Sparkles aria-hidden="true" />
                        {t('runs.questions.recommended')}
                      </Badge>
                    ) : null}
                  </Button>
                ))}
              </div>
            ) : recommendation ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles aria-hidden="true" className="size-3" />
                {t('runs.questions.recommendation', { text: recommendation })}
              </p>
            ) : null}
            <Textarea
              aria-label={t('runs.questions.answerTo', { index: index + 1 })}
              value={values[index]}
              onChange={(event) => onDraft(keys[index]!, event.target.value)}
              rows={2}
            />
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={empty > 0}>
          {t('runs.questions.answer')}
        </Button>
        {empty > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t('runs.questions.unanswered', { n: empty })}
          </span>
        ) : null}
      </div>
    </form>
  );
}
