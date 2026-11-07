import { useTranslation } from 'react-i18next';

import type { QueueView } from '../../../shared/api/types.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import type { QueueModesState } from './useQueueModes.ts';

/** What the queue does when the usage limit is reached. */
export function OnLimitField({ queue, modes }: { queue: QueueView; modes: QueueModesState }) {
  const { t } = useTranslation();
  const { pendingLimit, changeLimit } = modes;
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor="queue-on-limit" className="text-sm font-medium">
        {t('queue.settings.onLimit')}
      </label>
      <Select
        value={pendingLimit ?? queue.onLimit}
        disabled={pendingLimit !== null}
        onValueChange={(value) => void changeLimit(value === 'stop' ? 'stop' : 'wait')}
      >
        <SelectTrigger id="queue-on-limit" aria-describedby="queue-on-limit-hint">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="wait">{t('queue.settings.onLimitWait')}</SelectItem>
          <SelectItem value="stop">{t('queue.settings.onLimitStop')}</SelectItem>
        </SelectContent>
      </Select>
      <p id="queue-on-limit-hint" className="text-xs text-muted-foreground">
        {t('queue.settings.onLimitHint')}
      </p>
    </div>
  );
}
