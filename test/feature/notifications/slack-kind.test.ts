import { describe, expect, it } from 'vitest';

import {
  allowedUsers,
  slackAdapter,
} from '../../../src/feature/notifications/clients/slack/kind.ts';
import { builtInAdapters } from '../../../src/app/notifications/index.ts';
import { fixture } from '../integrations/helpers.ts';

const PARAMS = { channel_id: 'C0123456789', allowed_users: 'U01AAAAAAA,U01BBBBBBB' };

describe('slack kind', () => {
  it('is among the adapters this build brings', () => {
    expect(builtInAdapters().map((one) => one.descriptor.kind)).toEqual(['telegram', 'slack']);
  });

  it('creates a disabled connection and shows that both secrets are missing', async () => {
    const f = fixture({ adapters: [slackAdapter()] });
    const added = await f.services.connections.add({
      kind: 'slack',
      name: 'team',
      repository: '/work/app',
      params: PARAMS,
    });
    expect(added.enabled).toBe(false);
    const [view] = await f.services.connections.list('app');
    expect(view?.secrets).toEqual([
      { slot: 'bot_token', required: true, present: false },
      { slot: 'app_token', required: true, present: false },
    ]);
    expect(view?.params).toEqual(PARAMS);
  });

  it('takes the optional language and team', async () => {
    const f = fixture({ adapters: [slackAdapter()] });
    await expect(
      f.services.connections.add({
        kind: 'slack',
        name: 'team',
        global: true,
        params: { ...PARAMS, language: 'ru', team_id: 'T0123456789' },
      }),
    ).resolves.toMatchObject({ params: { language: 'ru', team_id: 'T0123456789' } });
  });

  it.each([
    ['channel_id', 'general'],
    ['channel_id', 'c0123456789'],
    ['allowed_users', 'alice'],
    ['allowed_users', 'U01AAAAAAA,'],
    ['language', 'de'],
    ['team_id', 'workspace'],
  ])('refuses a wrong %s (%s) and names the parameter', async (name, value) => {
    const f = fixture({ adapters: [slackAdapter()] });
    await expect(
      f.services.connections.add({
        kind: 'slack',
        name: 'team',
        global: true,
        params: { ...PARAMS, [name]: value },
      }),
    ).rejects.toThrow(new RegExp(name));
  });

  it('refuses an unknown parameter and a missing channel or user list', async () => {
    const f = fixture({ adapters: [slackAdapter()] });
    const add = (params: Record<string, string>) =>
      f.services.connections.add({ kind: 'slack', name: 'team', global: true, params });
    await expect(add({ ...PARAMS, webhook: 'x' })).rejects.toThrow();
    await expect(add({ allowed_users: PARAMS.allowed_users })).rejects.toThrow(/channel_id/);
    await expect(add({ channel_id: PARAMS.channel_id })).rejects.toThrow(/allowed_users/);
  });

  it('never shows a secret in the answers and does not take one as a parameter', async () => {
    const f = fixture({ adapters: [slackAdapter()] });
    const added = await f.services.connections.add({
      kind: 'slack',
      name: 'team',
      global: true,
      params: PARAMS,
    });
    await f.services.connections.setSecret(added.id, 'bot_token', 'xoxb-secret-value');
    await f.services.connections.setSecret(added.id, 'app_token', 'xapp-secret-value');
    const shown = JSON.stringify(await f.services.connections.list());
    expect(shown).not.toContain('secret-value');
    expect(shown).toContain('"present":true');
    await expect(
      f.services.connections.add({
        kind: 'slack',
        name: 'other',
        global: true,
        params: { ...PARAMS, bot_token: 'xoxb-x' },
      }),
    ).rejects.toThrow();
  });

  it('reads the allowed users', () => {
    expect(allowedUsers({ allowed_users: 'U01AAAAAAA, W01BBBBBBB' })).toEqual([
      'U01AAAAAAA',
      'W01BBBBBBB',
    ]);
    expect(allowedUsers({})).toEqual([]);
  });
});
