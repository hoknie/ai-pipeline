import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeliveryMode } from '../../../../../src/feature/swarm-config/types/index.ts';
import { isServerMode } from '../../../shared/api/http.ts';
import type { Api } from '../../../shared/api/api.ts';
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
import { BranchField } from './branch/BranchField.tsx';
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
      onCheckedChange={(autoDeliver) =>
        change({ autoDeliver, ...(autoDeliver ? {} : { deliveryBranch: null }) })
      }
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
            onClick={() =>
              change({ autoDeliver: null, ...((fallback ?? true) ? {} : { deliveryBranch: null }) })
            }
          />
        ) : null
      }
    />
  );
}

function ModeSelect({ state, fallback }: { state: FormState; fallback: DeliveryMode | null }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change } = state;
  // On the server only the mode `branch` exists: the others are refused there.
  const server = isServerMode();
  const modes = server ? DELIVERY_MODES.filter((mode) => mode === 'branch') : DELIVERY_MODES;
  const value = server ? 'branch' : (effective.deliveryMode ?? fallback ?? 'worktree');
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
            onClick={() =>
              change({
                deliveryMode: null,
                ...((fallback ?? 'worktree') === 'commit' ? {} : { deliveryBranch: null }),
              })
            }
          />
        ) : null}
      </div>
      <Select
        value={value}
        onValueChange={(deliveryMode) =>
          change({
            deliveryMode: deliveryMode as DeliveryMode,
            ...(deliveryMode === 'commit' ? {} : { deliveryBranch: null }),
          })
        }
      >
        <SelectTrigger id={`${idPrefix}-delivery-mode`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {modes.map((mode) => (
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
  api?: Api | undefined;
  repository?: string | null;
  branchValidation?: 'valid' | 'pending' | 'invalid';
}) {
  const { state } = props;
  const { t } = useTranslation();
  const [cleared, setCleared] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const allowed =
    !isServerMode() &&
    (state.effective.autoDeliver ?? props.autoDeliverDefault ?? true) &&
    (state.effective.deliveryMode ?? props.deliveryModeDefault ?? 'worktree') === 'commit';
  useEffect(() => {
    if (!allowed && state.effective.deliveryBranch) {
      state.change({ deliveryBranch: null });
      setCleared(true);
    }
  }, [allowed, state.effective.deliveryBranch]);
  useEffect(() => {
    if (allowed && state.effective.deliveryBranch && props.branchValidation === 'invalid') {
      state.change({ deliveryBranch: null });
      setInvalid(true);
    }
  }, [allowed, state.effective.deliveryBranch, props.branchValidation]);
  const wrapped = {
    ...state,
    change: (patch: Parameters<typeof state.change>[0]) => {
      if (state.effective.deliveryBranch && patch.deliveryBranch === null) setCleared(true);
      state.change(patch);
    },
  };
  return (
    <fieldset disabled={state.locked} className="contents">
      <AutoDeliver state={wrapped} fallback={props.autoDeliverDefault} />
      <ModeSelect state={wrapped} fallback={props.deliveryModeDefault} />
      {cleared && !isServerMode() ? (
        <p className="text-xs text-muted-foreground">{t('queue.form.branchCleared')}</p>
      ) : null}
      {invalid && allowed ? <p role="alert">{t('queue.form.branchInvalid')}</p> : null}
      {allowed ? (
        <BranchField
          state={wrapped}
          api={props.api}
          repository={props.repository ?? null}
          validation={props.branchValidation ?? 'valid'}
        />
      ) : null}
    </fieldset>
  );
}
