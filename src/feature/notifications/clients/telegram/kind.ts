import type { AdapterDescriptor } from '../../../integrations/types/index.ts';

export const TELEGRAM_KIND = 'telegram';

/** What the catalog of integrations knows about the kind: parameters and the one secret slot. */
export const telegramDescriptor: AdapterDescriptor = {
  kind: TELEGRAM_KIND,
  title: 'Telegram bot',
  params: [
    // A user, a group or a supergroup: a signed whole number.
    { name: 'chat_id', required: false, maxLength: 20, pattern: '-?[1-9][0-9]{0,17}' },
    // Positive user ids, separated by commas: the only people whose answers are accepted.
    {
      name: 'allowed_users',
      required: false,
      userList: true,
      maxLength: 400,
      pattern: '[1-9][0-9]{0,17}(,[1-9][0-9]{0,17})*',
    },
    { name: 'language', required: false, maxLength: 2, values: ['en', 'ru'] },
  ],
  secrets: [{ slot: 'bot_token', required: true }],
  directions: ['inbound', 'outbound'],
  operations: [],
};

/** The adapter of the integrations: the kind has no operations beyond what the channel does. */
export function telegramAdapter(): { descriptor: AdapterDescriptor } {
  return { descriptor: telegramDescriptor };
}

/** The ids of the users the connection allows, from the parameter. */
export function allowedUsers(params: Readonly<Record<string, string>>): string[] {
  return (params.allowed_users ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}
