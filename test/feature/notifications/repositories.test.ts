import { describe, expect, it } from 'vitest';

import {
  AnswerRepository,
  CursorRepository,
  DeliveryOutcomes,
  DeliveryRepository,
  SubscriptionRepository,
  newShortKey,
} from '../../../src/feature/notifications/repositories/index.ts';
import type { EventData, Subscription } from '../../../src/feature/notifications/types/index.ts';

import { fixture } from '../integrations/helpers.ts';

export const payload: EventData = {
  number: 1,
  title: 'Task',
  project: 'app',
  pipeline: 'feature',
  group: 'g',
  groupTitle: 'G',
  step: 'plan',
  question: 'q?',
  questions: null,
  humanOnly: null,
  summary: null,
  reason: null,
  outcome: null,
  merged: 0,
  groups: 1,
  asked: 0,
};

const subscription = (patch: Partial<Subscription> = {}): Subscription => ({
  id: 's1',
  connectionId: 'c1',
  projectPath: '/work/app',
  events: ['question'],
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

function repositories() {
  const { database } = fixture();
  const subscriptions = new SubscriptionRepository(database);
  subscriptions.insert(subscription());
  subscriptions.insert(subscription({ id: 's2', connectionId: 'c2', projectPath: null }));
  return {
    database,
    subscriptions,
    deliveries: new DeliveryRepository(database),
    outcomes: new DeliveryOutcomes(database),
  };
}

const input = (
  eventKey: string,
  subscriptionId = 's1',
  kind: 'question' | 'failed' = 'question',
) => ({
  subscriptionId,
  eventKey,
  kind,
  run: 'r1',
  group: 'g',
  questionKey: kind === 'question' ? eventKey : null,
  payload,
});

describe('subscription repository', () => {
  it('keeps, finds and moves subscriptions', () => {
    const { subscriptions } = repositories();
    expect(subscriptions.all().map((one) => one.id)).toEqual(['s1', 's2']);
    subscriptions.setEvents('s1', ['question', 'failed'], 5);
    subscriptions.setEnabled('s1', false, 6);
    expect(subscriptions.find('s1')).toMatchObject({
      events: ['question', 'failed'],
      enabled: false,
      updatedAt: 6,
    });
    subscriptions.moveProject('/work/app', '/work/moved');
    expect(subscriptions.find('s1')?.projectPath).toBe('/work/moved');
    subscriptions.deleteOfProject('/work/moved');
    expect(subscriptions.find('s1')).toBeUndefined();
    expect(subscriptions.find('s2')).toBeDefined();
    subscriptions.deleteOfConnection('c2');
    expect(subscriptions.all()).toEqual([]);
  });
});

describe('delivery repository', () => {
  it('records an event once per subscription', () => {
    const { deliveries, outcomes } = repositories();
    const first = deliveries.claim(input('e1'), 10);
    expect(first).toMatchObject({ state: 'pending', attempts: 0, run: 'r1', nextAttemptAt: 10 });
    expect(deliveries.claim(input('e1'), 11)).toBeNull();
    expect(deliveries.claim(input('e1', 's2'), 11)).not.toBeNull();
    expect(deliveries.ofEvent('e1')).toHaveLength(2);
  });

  it('gives every delivery its own short key that finds it', () => {
    const { deliveries, outcomes } = repositories();
    const one = deliveries.claim(input('e1'), 10)!;
    const two = deliveries.claim(input('e2'), 10)!;
    expect(one.shortKey).toMatch(/^[A-Z2-7]{10}$/);
    expect(one.shortKey).not.toBe(two.shortKey);
    expect(deliveries.findByShortKey(one.shortKey)?.id).toBe(one.id);
    expect(newShortKey()).toMatch(/^[A-Z2-7]{10}$/);
  });

  it('is born closed for an event from before the subscription', () => {
    const { deliveries, outcomes } = repositories();
    const old = deliveries.claim(
      { ...input('e1', 's1', 'failed'), closedBy: 'before_subscription' },
      10,
    )!;
    expect(old).toMatchObject({ state: 'closed', closedBy: 'before_subscription' });
    expect(deliveries.due(100, 10)).toEqual([]);
  });

  it('selects the pending ones whose time has come, oldest first', () => {
    const { deliveries, outcomes } = repositories();
    const late = deliveries.claim(input('late'), 10)!;
    const early = deliveries.claim(input('early'), 10)!;
    outcomes.markRetry(late.id, 1, 500, 'busy', 20);
    outcomes.markRetry(early.id, 1, 100, 'busy', 20);
    expect(deliveries.due(99, 10)).toEqual([]);
    expect(deliveries.due(100, 10).map((one) => one.eventKey)).toEqual(['early']);
    expect(deliveries.due(600, 10).map((one) => one.eventKey)).toEqual(['early', 'late']);
    expect(deliveries.nextAttemptAt()).toBe(100);
    outcomes.markSent(early.id, { chat_id: '1', message_id: 7 }, 2, 30);
    expect(deliveries.nextAttemptAt()).toBe(500);
    expect(deliveries.find(early.id)).toMatchObject({
      state: 'sent',
      attempts: 2,
      external: { chat_id: '1', message_id: 7 },
      lastError: null,
    });
  });

  it('finds the delivery of a message of a connection', () => {
    const { deliveries, outcomes } = repositories();
    const one = deliveries.claim(input('e1'), 10)!;
    outcomes.markSent(one.id, { chat_id: '1', message_id: 42 }, 1, 11);
    expect(deliveries.findByMessage('c1', '42')?.id).toBe(one.id);
    expect(deliveries.findByMessage('c2', '42')).toBeUndefined();
    expect(deliveries.findByMessage('c1', '43')).toBeUndefined();
  });

  it('closes and fails deliveries and keeps the first closure', () => {
    const { deliveries, outcomes } = repositories();
    const one = deliveries.claim(input('e1'), 10)!;
    outcomes.setClosedBy(one.id, 'first', 11);
    outcomes.markClosed(one.id, 'second', 12);
    expect(deliveries.find(one.id)).toMatchObject({ state: 'closed', closedBy: 'first' });
    const two = deliveries.claim(input('e2'), 10)!;
    outcomes.markFailed(two.id, 1, 'unauthorized', 13);
    expect(deliveries.find(two.id)).toMatchObject({ state: 'failed', lastError: 'unauthorized' });
    expect(deliveries.journal({ state: 'failed', limit: 10 }).map((row) => row.id)).toEqual([
      two.id,
    ]);
    expect(deliveries.journal({ subscription: 's2', limit: 10 })).toEqual([]);
  });

  it('closes the pending deliveries of a connection', () => {
    const { deliveries, outcomes } = repositories();
    const one = deliveries.claim(input('e1'), 10)!;
    const other = deliveries.claim(input('e1', 's2'), 10)!;
    outcomes.closePendingOfConnection('c1', 'connection_removed', 20);
    expect(deliveries.find(one.id)).toMatchObject({
      state: 'closed',
      closedBy: 'connection_removed',
    });
    expect(deliveries.find(other.id)?.state).toBe('pending');
  });

  it('clears what is older than the retention but keeps an open question', () => {
    const { deliveries, outcomes } = repositories();
    const open = deliveries.claim(input('open'), 1)!;
    outcomes.markSent(open.id, { message_id: 1 }, 1, 1);
    const info = deliveries.claim(input('info', 's1', 'failed'), 1)!;
    outcomes.markSent(info.id, { message_id: 2 }, 1, 1);
    const fresh = deliveries.claim(input('fresh'), 1)!;
    outcomes.markFailed(fresh.id, 1, 'x', 100);
    const waiting = deliveries.claim(input('waiting'), 1)!;
    expect(outcomes.prune(50)).toBe(1);
    expect(deliveries.find(open.id)).toBeDefined();
    expect(deliveries.find(info.id)).toBeUndefined();
    expect(deliveries.find(fresh.id)).toBeDefined();
    expect(deliveries.find(waiting.id)).toBeDefined();
  });

  it('removes the deliveries and their drafts with the subscription', () => {
    const { deliveries, outcomes, subscriptions, database } = repositories();
    const one = deliveries.claim(input('e1'), 10)!;
    new AnswerRepository(database).set(one.id, 0, 'A', 'u', 1);
    subscriptions.delete('s1');
    expect(deliveries.find(one.id)).toBeUndefined();
    expect(new AnswerRepository(database).all(one.id)).toEqual([]);
  });
});

describe('answer and cursor repositories', () => {
  it('replaces the answer of a question and clears them all', () => {
    const { database, deliveries, outcomes } = repositories();
    const one = deliveries.claim(input('e1'), 10)!;
    const answers = new AnswerRepository(database);
    answers.set(one.id, 1, 'B', 'u1', 1);
    answers.set(one.id, 0, 'A', 'u1', 2);
    answers.set(one.id, 1, 'C', 'u2', 3);
    expect(answers.all(one.id)).toEqual([
      { index: 0, answer: 'A' },
      { index: 1, answer: 'C' },
    ]);
    answers.clear(one.id);
    expect(answers.all(one.id)).toEqual([]);
  });

  it('keeps the read position of a connection', () => {
    const { database } = repositories();
    const cursors = new CursorRepository(database);
    expect(cursors.get('c1')).toBeNull();
    cursors.set('c1', '10', 1);
    cursors.set('c1', '11', 2);
    expect(cursors.get('c1')).toBe('11');
    cursors.delete('c1');
    expect(cursors.get('c1')).toBeNull();
  });
});
