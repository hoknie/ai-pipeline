import { describe, expect, it } from 'vitest';

import { catalogKinds } from '../src/features/integrations/catalog/kinds.ts';
import { integrationsOverview } from './fixtures.ts';

describe('catalogKinds', () => {
  it('leaves out the webhook and the kinds with a command of their own, in the order of the daemon', () => {
    const base = integrationsOverview().types[0]!;
    const types = [
      { ...base, kind: 'slack', title: 'Slack' },
      { ...base, kind: 'webhook', title: 'Webhook', createdBy: 'aip webhook add' },
      { ...base, kind: 'custom', title: 'Custom', createdBy: 'aip custom add' },
      { ...base, kind: 'telegram', title: 'Telegram' },
    ];
    expect(catalogKinds(types).map((type) => type.kind)).toEqual(['slack', 'telegram']);
  });
});
