import type { AdapterDescriptor } from '../../../integrations/types/index.ts';

export const SLACK_KIND = 'slack';

/** What the catalog of integrations knows about the kind: parameters and the two secret slots. */
export const slackDescriptor: AdapterDescriptor = {
  kind: SLACK_KIND,
  title: 'Slack app',
  params: [
    // A public or a private channel: `C…` or `G…`.
    { name: 'channel_id', required: true, maxLength: 40, pattern: '[CG][A-Z0-9]{8,}' },
    // Slack user ids, separated by commas: the only people whose answers are accepted.
    {
      name: 'allowed_users',
      required: false,
      userList: true,
      maxLength: 400,
      pattern: '[UW][A-Z0-9]{8,}(,[UW][A-Z0-9]{8,})*',
    },
    { name: 'language', required: false, maxLength: 2, values: ['en', 'ru'] },
    // The workspace the events must come from; empty: any.
    { name: 'team_id', required: false, maxLength: 40, pattern: 'T[A-Z0-9]{8,}' },
  ],
  secrets: [
    { slot: 'bot_token', required: true },
    { slot: 'app_token', required: true },
  ],
  directions: ['inbound', 'outbound'],
  operations: [],
};

/** The adapter of the integrations: the kind has no operations beyond what the channel does. */
export function slackAdapter(): { descriptor: AdapterDescriptor } {
  return { descriptor: slackDescriptor };
}

/** The ids of the users the connection allows, from the parameter. */
export function allowedUsers(params: Readonly<Record<string, string>>): string[] {
  return (params.allowed_users ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}
