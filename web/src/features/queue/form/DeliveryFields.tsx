import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DeliveryMode } from '../../../../../src/feature/swarm-config/types/index.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { DELIVERY_MODES } from '../../../shared/lib/pipeline/deliveryModes.ts';
import { SwitchRow } from './properties/FormSection.tsx';
import type { FormState } from './TaskFields.tsx';

/** Where a value comes from: the setting of the project or this task. */
function SourceBadge({
  own,
  bySetting,
  forTask,
}: {
  own: boolean;
  bySetting: string;
  forTask: string;
}) {
  return (
    <Badge variant={own ? 'run' : 'mute'} className="font-normal">
      {own ? forTask : bySetting}
    </Badge>
  );
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onClick}
    >
      <RotateCcw className="size-3.5" aria-hidden />
    </button>
  );
}

function AutoDeliver({ state, fallback }: { state: FormState; fallback: boolean | null }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  return (
    <SwitchRow
      id={`${idPrefix}-auto-deliver`}
      label={t('queue.form.autoDeliver')}
      checked={effective.autoDeliver ?? fallback ?? true}
      onCheckedChange={(autoDeliver) => change({ autoDeliver })}
      badge={
        <SourceBadge
          own={effective.autoDeliver !== null}
          bySetting={t('queue.form.autoDeliverBySetting')}
          forTask={t('queue.form.autoDeliverForTask')}
        />
      }
      action={
        effective.autoDeliver !== null ? (
          <ResetButton
            label={t('queue.form.autoDeliverReset')}
            onClick={() => change({ autoDeliver: null })}
          />
        ) : null
      }
    />
  );
}

function ModeSelect({ state, fallback }: { state: FormState; fallback: DeliveryMode | null }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Label htmlFor={`${idPrefix}-delivery-mode`}>{t('queue.form.deliveryMode')}</Label>
        <SourceBadge
          own={effective.deliveryMode !== null}
          bySetting={t('queue.form.deliveryModeBySetting')}
          forTask={t('queue.form.deliveryModeForTask')}
        />
        {effective.deliveryMode !== null ? (
          <ResetButton
            label={t('queue.form.deliveryModeReset')}
            onClick={() => change({ deliveryMode: null })}
          />
        ) : null}
      </div>
      <Select
        value={effective.deliveryMode ?? fallback ?? 'worktree'}
        onValueChange={(deliveryMode) => change({ deliveryMode: deliveryMode as DeliveryMode })}
      >
        <SelectTrigger id={`${idPrefix}-delivery-mode`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DELIVERY_MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`deliveryMode.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The «Delivery» section: automatic delivery and the way of delivery. */
export function DeliveryFields(props: {
  state: FormState;
  autoDeliverDefault: boolean | null;
  deliveryModeDefault: DeliveryMode | null;
}) {
  const { state } = props;
  return (
    <fieldset disabled={state.locked} className="contents">
      <AutoDeliver state={state} fallback={props.autoDeliverDefault} />
      <ModeSelect state={state} fallback={props.deliveryModeDefault} />
    </fieldset>
  );
}
