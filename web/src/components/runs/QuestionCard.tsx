import { notifySuccess } from '../../notify.ts';
import { Button } from '../../ui/button.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import { Markdown } from '../Markdown.tsx';
import { useTranslation } from 'react-i18next';

/** A plain question of a specialist with one field for the answer. */
export function QuestionCard({
  title,
  question,
  draft,
  busy,
  onDraft,
  onSubmit,
}: {
  title: string;
  question: string | null;
  draft: string;
  busy: boolean;
  onDraft: (text: string) => void;
  onSubmit: (answer: string, done: () => void) => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-status-warn/40 bg-status-warn-bg p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim())
          onSubmit(draft, () => {
            onDraft('');
            notifySuccess(t('runs.questions.answerSent'));
          });
      }}
    >
      <div className="text-status-warn [&_*]:font-medium">
        <Markdown text={question ?? ''} />
      </div>
      <Textarea
        aria-label={t('runs.questions.answerFor', { title })}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        rows={3}
      />
      <div>
        <Button type="submit" loading={busy} disabled={!draft.trim()}>
          {t('runs.questions.answer')}
        </Button>
      </div>
    </form>
  );
}
