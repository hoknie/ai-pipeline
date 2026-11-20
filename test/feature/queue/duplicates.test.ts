import { describe, expect, it } from 'vitest';

import {
  addItem,
  DUPLICATE_TASK_CODE,
  emptyQueue,
  findDuplicate,
  refuseDuplicate,
  sameTask,
  type Queue,
} from '../../../src/feature/queue/types/index.ts';
import { isAppError } from '../../../src/platform/errors/index.ts';

const LOGIN = { pipeline: 'feature', task: 'fix the login' };
const FORMS = [
  { title: 'login form', task: 'make the login form' },
  { title: 'signup form', task: 'make the signup form' },
];

function queueWith(...items: Parameters<typeof addItem>[1][]): Queue {
  const queue = emptyQueue('/work/app', 1);
  items.forEach((item, index) => addItem(queue, item, `q${index + 1}`, 2));
  return queue;
}

describe('the same task', () => {
  it('is the same pipeline and text, whatever the spaces around the text', () => {
    expect(sameTask(LOGIN, { ...LOGIN })).toBe(true);
    expect(sameTask(LOGIN, { ...LOGIN, task: ' fix the login\n' })).toBe(true);
    expect(sameTask(LOGIN, { ...LOGIN, task: 'fix the logout' })).toBe(false);
    expect(sameTask(LOGIN, { ...LOGIN, pipeline: 'task' })).toBe(false);
  });

  it('is another task on another variant or provider', () => {
    expect(sameTask(LOGIN, { ...LOGIN, variant: 'default' })).toBe(true);
    expect(sameTask(LOGIN, { ...LOGIN, variant: 'fast' })).toBe(false);
    expect(sameTask(LOGIN, { ...LOGIN, provider: null })).toBe(true);
    expect(sameTask(LOGIN, { ...LOGIN, provider: 'zai' })).toBe(false);
  });

  it('compares groups by number, order, titles and texts', () => {
    const forms = { pipeline: 'feature', groups: FORMS };
    expect(sameTask(forms, { pipeline: 'feature', groups: FORMS.map((one) => ({ ...one })) })).toBe(
      true,
    );
    expect(sameTask(forms, { pipeline: 'feature', groups: [...FORMS].reverse() })).toBe(false);
    expect(sameTask(forms, { pipeline: 'feature', groups: FORMS.slice(0, 1) })).toBe(false);
    expect(
      sameTask(forms, {
        pipeline: 'feature',
        groups: [FORMS[0]!, { ...FORMS[1]!, task: 'another text' }],
      }),
    ).toBe(false);
  });

  it('never matches a text with groups', () => {
    expect(
      sameTask(
        { pipeline: 'feature', task: 'make the login form' },
        { pipeline: 'feature', groups: [FORMS[0]!] },
      ),
    ).toBe(false);
  });
});

describe('a copy of a waiting task', () => {
  it('is found whatever its title, tags, dependencies and other settings', () => {
    const queue = queueWith(
      { pipeline: 'feature', task: 'model' },
      { ...LOGIN, title: 'Login', tags: ['auth'], after: ['q1'], skip: ['qa'], postponed: true },
    );
    expect(findDuplicate(queue, { ...LOGIN })?.id).toBe('q2');
    expect(findDuplicate(queue, { ...LOGIN, task: 'something else' })).toBeUndefined();
  });

  it('is not a returned run', () => {
    const queue = queueWith(LOGIN);
    queue.items[0]!.run = 'r1';
    expect(findDuplicate(queue, LOGIN)).toBeUndefined();
  });

  it('is refused with the number and the id of the waiting task, unless a copy is asked for', () => {
    const queue = queueWith({ pipeline: 'feature', task: 'model' }, LOGIN);
    let refusal: unknown;
    try {
      refuseDuplicate(queue, LOGIN);
    } catch (error) {
      refusal = error;
    }
    expect(isAppError(refusal) && refusal.code).toBe(DUPLICATE_TASK_CODE);
    expect((refusal as Error).message).toBe(
      'task #2 (q2) with the same pipeline and task already waits in the queue',
    );
    expect(() => refuseDuplicate(queue, LOGIN, true)).not.toThrow();
    expect(() => refuseDuplicate(queue, { ...LOGIN, task: 'new' })).not.toThrow();
  });
});
