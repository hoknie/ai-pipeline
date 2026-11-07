import { useTranslation } from 'react-i18next';

import type { DeliveryMode } from '../../../../../src/feature/swarm-config/types/index.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../shared/ui/forms/select.tsx';
import { DELIVERY_MODES } from '../../../shared/lib/pipeline/deliveryModes.ts';
import type { PipelinesView } from '../../../shared/api/types.ts';
import { stepsOf } from '../draft.ts';
import { SkipSteps } from '../SkipSteps.tsx';
import type { FormState } from './TaskFields.tsx';

function AutoDeliver({ state, fallback }: { state: FormState; fallback: boolean | null }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch
        id={`${idPrefix}-auto-deliver`}
        checked={effective.autoDeliver ?? fallback ?? true}
        onCheckedChange={(autoDeliver) => change({ autoDeliver })}
      />
      <Label htmlFor={`${idPrefix}-auto-deliver`}>{t('queue.form.autoDeliver')}</Label>
      <span className="text-xs text-muted-foreground">
        {effective.autoDeliver === null
          ? t('queue.form.autoDeliverBySetting')
          : t('queue.form.autoDeliverForTask')}
      </span>
      {effective.autoDeliver !== null ? (
        <Button variant="ghost" size="sm" onClick={() => change({ autoDeliver: null })}>
          {t('queue.form.autoDeliverReset')}
        </Button>
      ) : null}
    </div>
  );
}

function ModeSelect({ state, fallback }: { state: FormState; fallback: DeliveryMode | null }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`${idPrefix}-delivery-mode`}>{t('queue.form.deliveryMode')}</Label>
      <Select
        value={effective.deliveryMode ?? fallback ?? 'worktree'}
        onValueChange={(deliveryMode) => change({ deliveryMode: deliveryMode as DeliveryMode })}
      >
        <SelectTrigger id={`${idPrefix}-delivery-mode`} className="w-48">
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
      <span className="text-xs text-muted-foreground">
        {effective.deliveryMode === null
          ? t('queue.form.deliveryModeBySetting')
          : t('queue.form.deliveryModeForTask')}
      </span>
      {effective.deliveryMode !== null ? (
        <Button variant="ghost" size="sm" onClick={() => change({ deliveryMode: null })}>
          {t('queue.form.deliveryModeReset')}
        </Button>
      ) : null}
    </div>
  );
}

/** Postponing, delivery of the result and the steps to skip. */
export function DeliveryFields(props: {
  state: FormState;
  pipelines: PipelinesView | null;
  autoDeliverDefault: boolean | null;
  deliveryModeDefault: DeliveryMode | null;
}) {
  const { t } = useTranslation();
  const { state } = props;
  const { idPrefix, effective, change, locked } = state;
  return (
    <fieldset disabled={locked} className="contents">
      {idPrefix === 'new' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            id={`${idPrefix}-postponed`}
            checked={effective.postponed === true}
            onCheckedChange={(postponed) => change({ postponed })}
          />
          <Label htmlFor={`${idPrefix}-postponed`}>{t('queue.form.postpone')}</Label>
          <span className="text-xs text-muted-foreground">{t('queue.list.activeHint')}</span>
        </div>
      ) : null}
      <AutoDeliver state={state} fallback={props.autoDeliverDefault} />
      <ModeSelect state={state} fallback={props.deliveryModeDefault} />
      <SkipSteps
        idPrefix={idPrefix}
        steps={stepsOf(
          props.pipelines?.pipelines.find((candidate) => candidate.id === effective.pipeline),
        )}
        skip={effective.skip}
        onChange={(skip) => change({ skip })}
      />
    </fieldset>
  );
}
