import { useTranslation } from 'react-i18next';

import type { QueueView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Textarea } from '../../../shared/ui/forms/textarea.tsx';
import type { QueueModesState } from './useQueueModes.ts';

/** The answer the autopilot gives to a question of a specialist. */
export function AutopilotAnswer({ queue, modes }: { queue: QueueView; modes: QueueModesState }) {
  const { t } = useTranslation();
  const { answer, setAnswer, savingAnswer, shownAnswer, saveAnswer } = modes;
  return (
    <div className={`flex flex-col gap-1 ${queue.autoAnswer ? '' : 'opacity-60'}`}>
      <label htmlFor="queue-autopilot-answer" className="text-sm font-medium">
        {t('queue.settings.autopilotAnswer')}
      </label>
      <Textarea
        id="queue-autopilot-answer"
        value={shownAnswer}
        maxLength={2000}
        onChange={(event) => setAnswer(event.target.value)}
      />
      <p id="queue-autopilot-answer-hint" className="text-xs text-muted-foreground">
        {t('queue.settings.autopilotAnswerHint')}
      </p>
      {queue.autoAnswer ? null : (
        <p id="queue-autopilot-answer-inactive" className="text-xs font-medium">
          {t('queue.settings.autopilotAnswerInactive')}
        </p>
      )}
      <span className="flex gap-2">
        <Button
          size="sm"
          disabled={
            savingAnswer ||
            answer === null ||
            answer.trim() === '' ||
            answer.trim() === (queue.autopilotAnswer ?? queue.autopilotAnswerDefault)
          }
          onClick={() => void saveAnswer(answer === null ? null : answer.trim())}
        >
          {t('queue.settings.autopilotAnswerSave')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={savingAnswer || (answer === null && queue.autopilotAnswer === null)}
          onClick={() => void saveAnswer(null)}
        >
          {t('queue.settings.autopilotAnswerDefault')}
        </Button>
      </span>
    </div>
  );
}
