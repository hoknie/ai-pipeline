import type { TFunction } from 'i18next';

import type { ConfirmOptions } from '../../../shared/ui/overlays/confirm.tsx';
import type { DefaultProviderState } from './useDefaultProvider.ts';

/**
 * Asks whether to take the default off the current provider and give it to `to`. A value of the
 * shared settings seen from a project gets a note that the other projects keep it.
 */
export function confirmDefaultChange(
  confirm: (options: ConfirmOptions) => Promise<boolean>,
  t: TFunction,
  state: DefaultProviderState,
  to: string,
): Promise<boolean> {
  const question = t('providers.default.confirmText', { from: state.currentName ?? '', to });
  const shared = state.current?.level === 'global' && state.scope === 'project';
  return confirm({
    title: t('providers.default.confirmTitle'),
    description: shared ? `${question} ${t('providers.default.confirmShared')}` : question,
    confirmLabel: t('providers.default.assign'),
  });
}
