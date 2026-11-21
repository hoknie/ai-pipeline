import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProviderView } from '../../../shared/api/types.ts';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import type { DefaultProviderState } from './useDefaultProvider.ts';
import { confirmDefaultChange } from './confirmDefaultChange.ts';

/**
 * The switch «Default» of a provider: it writes at once, without Save. Turning it on while another
 * provider is the default asks first, in a dialog; nothing is written before «Assign».
 */
export function DefaultProviderSwitch({
  provider,
  state,
}: {
  provider: ProviderView;
  state: DefaultProviderState;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { current, scope } = state;
  const isDefault = current?.slug === provider.slug;
  // the shared value is changed in the shared settings, or overridden by another provider here
  const inherited = isDefault && current.level === 'global' && scope === 'project';
  const off = !provider.enabled && !isDefault;
  const disabled = busy || !state.ready || inherited || off;
  const hint = inherited
    ? t('providers.default.sharedValue')
    : off
      ? t('providers.default.offHint')
      : t('providers.default.hint');

  const run = async (write: () => Promise<string | null>) => {
    setBusy(true);
    setFailure(await write());
    setBusy(false);
  };
  const change = async (on: boolean) => {
    setFailure(null);
    if (!on) return run(state.clear);
    if (current !== null && !isDefault) {
      const ok = await confirmDefaultChange(confirm, t, state, provider.name || provider.slug);
      if (!ok) return;
    }
    return run(() => state.assign(provider.slug));
  };
  const id = `provider-default-${provider.slug}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={id}
          checked={isDefault}
          disabled={disabled}
          onCheckedChange={(on) => void change(on)}
        />
        <label htmlFor={id} className="cursor-pointer text-sm">
          {t('providers.default.switch')}
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {failure ? (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
