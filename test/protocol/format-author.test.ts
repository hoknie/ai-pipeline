import { describe, expect, it } from 'vitest';

import { formatQueue, formatRun, formatRunList } from '../../src/presentation/format/index.ts';
import type { AuthorView } from '../../src/presentation/ipc/contract/index.ts';
import { queueView, runView } from '../../src/presentation/ipc/views/index.ts';
import { addItem, emptyQueue } from '../../src/feature/queue/types/index.ts';
import { run } from '../feature/runs/helpers.ts';

const ALICE: AuthorView = { id: 'u1', email: 'alice@corp.com', name: 'Alice', disabled: false };

describe('the author in the text of the CLI', () => {
  it('names the author of a task in the queue and of a run in the list and in the details', () => {
    const queue = emptyQueue('/repo', 1);
    addItem(queue, { pipeline: 'feature', task: 'A', author: 'u1' }, 'q1', 2);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 2);
    const view = queueView(queue, () => undefined);
    view.items[0]!.author = ALICE;
    const lines = formatQueue(view).split('\n');
    expect(lines.find((line) => line.includes('q1'))).toContain('by alice@corp.com');
    expect(lines.find((line) => line.includes('q2'))).not.toContain(' by ');

    const withAuthor = { ...runView(run(1), 2000), author: ALICE };
    expect(formatRunList([withAuthor])).toMatch(/AUTHOR/);
    expect(formatRunList([withAuthor])).toContain('alice@corp.com');
    expect(formatRun(withAuthor, 2000)).toContain('Author: alice@corp.com');
  });

  it('shows nothing about the author when nobody has one', () => {
    const view = runView(run(1), 2000);
    expect(view.author).toBeNull();
    expect(formatRunList([view])).not.toContain('AUTHOR');
    expect(formatRun(view, 2000)).not.toContain('Author:');
  });

  it('keeps the author in the JSON of a run as the API has it', () => {
    const view = { ...runView(run(1), 2000), author: ALICE };
    expect(JSON.parse(JSON.stringify(view)).author).toEqual(ALICE);
  });
});
