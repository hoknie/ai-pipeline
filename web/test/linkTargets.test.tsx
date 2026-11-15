import { describe, expect, it } from 'vitest';
import { linkTargets } from '../src/features/runs/index.ts';
import { queueItem, queueOf, queueRun, runView } from './fixtures.ts';

const label = (item: ReturnType<typeof queueItem>) => item.title ?? item.task ?? '';

describe('link targets', () => {
  it('offers finished runs only for non-blocking kinds and retains missing current links', () => {
    const edited = queueItem('edit', 'Edit', 1, {
      links: [
        { kind: 'related', id: 'missing', number: 5, title: '', repository: '/old', ref: null },
      ],
    });
    const queue = queueOf({ items: [edited, queueItem('waiting', 'Waiting', 2)] });
    const runs = [runView({ id: 'done', number: 7, finished: true, finishedAt: 10 })];
    const blocked = linkTargets('blocked_by', queue, runs, label, edited);
    expect(blocked.flatMap((group) => group.options.map((option) => option.id))).toEqual([
      'waiting',
    ]);
    const related = linkTargets('related', queue, runs, label, edited);
    expect(related.flatMap((group) => group.options.map((option) => option.id))).toEqual([
      'waiting',
      'done',
      'missing',
    ]);
    expect(related.at(-1)?.options[0]).toMatchObject({
      title: 'missing',
      number: null,
      project: 'old',
    });
  });

  it('orders run sections and foreign projects, deduplicating across sections', () => {
    const queue = queueOf({ items: [queueItem('item', 'Schema', 1)] });
    const runs = [
      runView({ id: 'a10', startedAt: 10 }),
      runView({ id: 'a11', startedAt: 11 }),
      runView({ id: 'planned', state: 'queued', startedAt: null, createdAt: 1 }),
      runView({
        id: 'returned',
        state: 'queued',
        queueItem: 'return-item',
        finished: true,
        createdAt: 2,
      }),
      runView({ id: 'started-queued', state: 'queued', startedAt: 9 }),
      runView({ id: 'paused', state: 'paused', queueItem: 'paused-item', startedAt: 8 }),
      runView({ id: 'f7', finished: true, finishedAt: 9 }),
      runView({ id: 'f8', finished: true, state: 'cancelled', finishedAt: 12 }),
    ];
    const others = [
      queueOf({ repository: '/z', items: [queueItem('z', 'Z', 3)] }),
      queueOf({
        repository: '/lib',
        items: [queueItem('item', 'Duplicate', 1), queueItem('api', 'API', 2)],
      }),
    ];
    const groups = linkTargets('parent', queue, runs, label, undefined, others);
    expect(
      groups.map((group) => [group.section, group.options.map((option) => option.id)]),
    ).toEqual([
      ['items', ['item']],
      ['active', ['a11', 'a10', 'started-queued', 'paused']],
      ['planned', ['returned', 'planned']],
      ['finished', ['f8', 'f7']],
      ['other', ['api', 'z']],
    ]);
    expect(groups.at(-1)?.options[0]).toMatchObject({ project: 'lib', title: 'API' });
  });

  it('offers items, runs and current links once, without the edited item', () => {
    const edited = queueItem('q2', 'b', 2, {
      links: [
        {
          kind: 'blocked_by',
          id: 'gone',
          number: 4,
          title: 'Упавший',
          repository: '/repo',
          ref: null,
        },
      ],
    });
    const queue = queueOf({
      items: [queueItem('q1', 'a', 1), edited],
      runs: [queueRun('run1', { title: 'Запуск' })],
    });
    const ids = (item?: typeof edited) =>
      linkTargets('blocked_by', queue, [], label, item).flatMap((group) =>
        group.options.map((option) => option.id),
      );
    expect(ids(edited)).toEqual(['q1', 'run1', 'gone']);
    expect(ids()).toEqual(['q1', 'q2', 'run1']);
  });

  it('puts a current link of another project once, in the other group', () => {
    const foreign = {
      kind: 'blocked_by' as const,
      id: 'ql',
      number: 3,
      title: 'API',
      repository: '/other',
      ref: null,
    };
    const edited = queueItem('q1', 'a', 1, { links: [foreign] });
    const queue = queueOf({ repository: '/repo', items: [edited] });
    const lib = queueOf({ repository: '/other', items: [queueItem('ql', 'API', 3)], runs: [] });
    const found = linkTargets('blocked_by', queue, [], label, edited, [lib]).filter((group) =>
      group.options.some((option) => option.id === 'ql'),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ section: 'other' });
    expect(found[0]!.options[0]).toMatchObject({ project: 'other' });
    // without the project among the others, the current link still names it
    const alone = linkTargets('blocked_by', queue, [], label, edited);
    expect(alone.at(-1)).toMatchObject({ section: 'current' });
    expect(alone.at(-1)!.options[0]).toMatchObject({ id: 'ql', project: 'other' });
  });

  it('orders place-holding runs by start time', () => {
    const queue = queueOf({ runs: [queueRun('old'), queueRun('new')] });
    const runs = [runView({ id: 'old', startedAt: 10 }), runView({ id: 'new', startedAt: 20 })];
    expect(linkTargets('blocked_by', queue, runs, label)[0]).toMatchObject({
      section: 'queueRuns',
      options: [{ id: 'new' }, { id: 'old' }],
    });
  });
});
