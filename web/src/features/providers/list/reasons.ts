import type { TFunction } from 'i18next';

/** A reason of the daemon for people; the five known patterns are translated, others stay as they are. */
export function reasonText(reason: string, t: TFunction): string {
  if (reason === 'access disabled') return t('providers.reasons.accessDisabled');
  if (reason === 'api access is not implemented') return t('providers.reasons.apiSoon');
  const runtime = /^runtime (.+) is disabled$/.exec(reason);
  if (runtime) return t('providers.reasons.runtimeDisabled', { runtime: runtime[1] ?? '' });
  const command = /^command (.+) not found$/.exec(reason);
  if (command) return t('providers.reasons.commandNotFound', { command: command[1] ?? '' });
  const variable = /^variable (.+) is not set$/.exec(reason);
  if (variable) return t('providers.reasons.variableNotSet', { name: variable[1] ?? '' });
  return reason;
}
