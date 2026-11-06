import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { DELIVERY_MODES, isDeliveryMode } from '../../deliveryModes.ts';
import type { ConfigEditorResponse } from '../../types.ts';
import { useGeneralSetting, useSetting } from '../../useGeneralSetting.ts';

import { Alert } from '../../ui/alert.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.tsx';
import { Switch } from '../../ui/switch.tsx';

export function Toggle({
  id,
  label,
  hint,
  note,
  checked,
  disabled,
  title,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  note?: string | null;
  checked: boolean;
  disabled: boolean;
  title?: string | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <div className="flex items-center gap-2">
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * «Auto delivery» and «Delivery mode». A write goes to the file the value comes from. The values
 * come from `config` (read once by the page); with `effective` (the queue) they follow the queue,
 * which is updated by events, and `null` there means that the configuration is not valid.
 */
export function DeliveryFields({
  api,
  config,
  onReload,
  effective,
  idPrefix,
  writeLevel,
}: {
  api: Api;
  config: ConfigEditorResponse | null;
  onReload: () => Promise<void> | void;
  effective?: { autoDeliver: boolean | null; deliveryMode: string | null };
  idPrefix: string;
  /** Writes to this level instead of the one each value comes from. */
  writeLevel?: 'global' | 'project';
}) {
  const { t } = useTranslation();
  const source = config ?? undefined;
  const auto = useGeneralSetting(api, 'delivery.auto', source, onReload, writeLevel);
  const mode = useSetting<string>(api, 'delivery.mode', 'string', source, onReload, writeLevel);
  const invalid = effective
    ? effective.autoDeliver === null || effective.deliveryMode === null
    : config !== null && config.errors.length > 0;
  const invalidTitle = invalid ? t('queue.settings.autoDeliverInvalid') : undefined;
  const checked = effective ? effective.autoDeliver === true : auto.value;
  const shownMode = effective ? effective.deliveryMode : mode.value;
  const savedTo = (setting: { level: 'global' | 'project'; file: string | null }) =>
    setting.file
      ? t(
          setting.level === 'project'
            ? 'queue.settings.savedToProject'
            : 'queue.settings.savedToGlobal',
          { file: setting.file },
        )
      : null;
  return (
    <>
      <Toggle
        id={`${idPrefix}-auto-deliver`}
        label={t('queue.settings.autoDeliver')}
        hint={t('queue.settings.autoDeliverHint')}
        checked={checked}
        disabled={invalid || !auto.ready || auto.busy}
        title={invalidTitle}
        note={invalidTitle ?? savedTo(auto)}
        onChange={(value) => void auto.set(value)}
      />
      {auto.failure ? <Alert variant="destructive">{auto.failure}</Alert> : null}
      <div className="flex flex-col gap-0.5" title={invalidTitle}>
        <label htmlFor={`${idPrefix}-delivery-mode`} className="text-sm font-medium">
          {t('queue.settings.deliveryMode')}
        </label>
        <Select
          value={shownMode !== null && isDeliveryMode(shownMode) ? shownMode : ''}
          disabled={invalid || !mode.ready || mode.busy}
          onValueChange={(value) => void mode.set(value)}
        >
          <SelectTrigger id={`${idPrefix}-delivery-mode`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DELIVERY_MODES.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {t(`deliveryMode.${candidate}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id={`${idPrefix}-delivery-mode-hint`} className="text-xs text-muted-foreground">
          {t('queue.settings.deliveryModeHint')}
        </p>
        {(invalidTitle ?? savedTo(mode)) ? (
          <p className="text-xs text-muted-foreground">{invalidTitle ?? savedTo(mode)}</p>
        ) : null}
      </div>
      {mode.failure ? <Alert variant="destructive">{mode.failure}</Alert> : null}
    </>
  );
}
