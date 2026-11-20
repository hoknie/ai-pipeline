import { afterEach, describe, expect, it } from 'vitest';

import type { IntegrationsServices } from '../../../src/feature/integrations/services/index.ts';
import {
  NotificationSenders,
  RecentSenders,
  SENDER_TTL_MS,
  SENDERS_PER_CONNECTION,
} from '../../../src/feature/notifications/services/senders/index.ts';

import { chatConnection, harness, type Harness } from './helpers.ts';

describe('recent senders', () => {
  it('keeps one entry per person, the latest first, with the latest name', () => {
    const recent = new RecentSenders();
    recent.note('c1', { user: '1', label: 'old' }, 100);
    recent.note('c1', { user: '2', label: null }, 200);
    recent.note('c1', { user: '1', label: '@alice' }, 300);
    expect(recent.list('c1', 400)).toEqual([
      { user: '1', label: '@alice', at: 300 },
      { user: '2', label: null, at: 200 },
    ]);
    expect(recent.list('c2', 400)).toEqual([]);
  });

  it('keeps twenty people per connection and drops the oldest', () => {
    const recent = new RecentSenders();
    for (let one = 1; one <= SENDERS_PER_CONNECTION + 1; one += 1) {
      recent.note('c1', { user: String(one), label: null }, one);
    }
    const users = recent.list('c1', 100).map((one) => one.user);
    expect(users).toHaveLength(SENDERS_PER_CONNECTION);
    expect(users[0]).toBe('21');
    expect(users).not.toContain('1');
  });

  it('forgets a person after seven days', () => {
    const recent = new RecentSenders();
    recent.note('c1', { user: '1', label: null }, 0);
    recent.note('c1', { user: '2', label: null }, 1000);
    expect(recent.list('c1', SENDER_TTL_MS - 1).map((one) => one.user)).toEqual(['2', '1']);
    expect(recent.list('c1', SENDER_TTL_MS).map((one) => one.user)).toEqual(['2']);
  });

  it('clears a connection', () => {
    const recent = new RecentSenders();
    recent.note('c1', { user: '1', label: null }, 0);
    recent.clear('c1');
    expect(recent.list('c1', 1)).toEqual([]);
  });

  it('cuts a long name to 64 characters and removes control characters', () => {
    const recent = new RecentSenders();
    recent.note('c1', { user: '1', label: `${'x'.repeat(100)}` }, 1);
    recent.note('c1', { user: '2', label: 'a\u0007b\nc' }, 2);
    recent.note('c1', { user: '3', label: '\u0007\n' }, 3);
    const [third, second, first] = recent.list('c1', 4);
    expect(first!.label).toBe('x'.repeat(64));
    expect(second!.label).toBe('a b c');
    expect(third!.label).toBeNull();
  });
});

let current: Harness | null = null;
afterEach(async () => {
  await current?.close();
  current = null;
});

describe('the senders of a connection', () => {
  it('offers who wrote lately, without those who are allowed already', async () => {
    const h = harness();
    current = h;
    const id = await chatConnection(h.base, { params: { chat_id: '-1', allowed_users: '111' } });
    await h.notifications.channels.settled();
    const { seen } = h.channels.built.at(-1)!.options;
    seen?.({ user: '111', label: '@alice' });
    seen?.({ user: '222', label: '@bob' });
    expect(h.notifications.senders.forConnection(id)).toEqual([
      { user: '222', label: '@bob', at: h.clock.time },
    ]);
    h.clock.time += SENDER_TTL_MS;
    expect(h.notifications.senders.forConnection(id)).toEqual([]);
  });

  it('refuses an unknown connection and gives nothing for a kind without a list of users', async () => {
    const h = harness();
    current = h;
    expect(() => h.notifications.senders.forConnection('nope')).toThrow(/not_found|not found/);
    const stub = {
      access: { find: () => ({ id: 'w1', kind: 'webhook', params: {} }) },
      connections: { types: () => [{ kind: 'webhook', params: [] }] },
    } as unknown as IntegrationsServices;
    const recent = new RecentSenders();
    recent.note('w1', { user: '1', label: null }, h.clock.time);
    const senders = new NotificationSenders({
      integrations: stub,
      recent,
      now: () => h.clock.time,
    });
    expect(senders.forConnection('w1')).toEqual([]);
  });
});
