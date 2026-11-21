import { useTranslation } from 'react-i18next';

import { useConfirm } from '../../../shared/ui/overlays/confirm.tsx';
import { confirmDefaultChange } from './confirmDefaultChange.ts';
import type { DefaultProviderState } from './useDefaultProvider.ts';
import type { ProviderDraft } from '../form/draft.ts';

/**
 * The change handler of the step «General»: making the new provider the default while another one
 * is asks first; a refusal leaves the draft as it was.
 */
export function useMakeDefault(
  defaults: DefaultProviderState,
  setDraft: (patch: Partial<ProviderDraft>) => void,
  draft: ProviderDraft | null,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return async (patch: Partial<ProviderDraft>) => {
    if (patch.makeDefault === true && defaults.current !== null) {
      const name = draft?.name || draft?.slug || '';
      if (!(await confirmDefaultChange(confirm, t, defaults, name))) return;
    }
    setDraft(patch);
  };
}
