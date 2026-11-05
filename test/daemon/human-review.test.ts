import { describe, expect, it } from 'vitest';

import { settle, WORKFLOW_CONFIG } from './harness.ts';
import { add, allRuns, queueOf, start, waitQueue } from './queue-harness.ts';

const REVIEW_CONFIG = WORKFLOW_CONFIG.replace(
  'specialist: reviewer,',
  'specialist: reviewer, human_review: true,',
);

describe('human review in a queue with auto answer', () => {
  it('waits on the review, then goes on after the answer of a person', async () => {
    const h = await start(REVIEW_CONFIG);
    h.script({ review: [{ summary: 'проверь архитектуру' }, { summary: 'принято' }] });
    await h.call('queue_settings', { repository: h.repo, autoAnswer: true });
    await add(h, 'A');
    await h.call('queue_start', { repository: h.repo });
    await waitQueue(h, (queue) => queue.runs[0]?.problem?.reason === 'needs_human');
    await settle(h);
    // the autopilot leaves the question alone
    expect((await queueOf(h)).runs[0]?.problem?.reason).toBe('needs_human');
    const [created] = await allRuns(h);
    const runId = created!.id;
    const row = (await h.status(runId)).groups[0]!;
    expect(row).toMatchObject({ status: 'needs_human', humanOnly: 'review', step: 'review' });
    expect(row.question).toContain('проверь архитектуру');
    expect((await h.group(runId, row.slug)).humanOnly).toBe('review');
    expect(h.running.daemon.state(runId).groups[0]?.decisions).toEqual([]);

    await h.call('answer', { runId, group: row.slug, answer: 'Принято' });
    const final = await h.waitFor(runId, (view) => view.finished);
    expect(final.groups.map((group) => group.status)).toEqual(['merged']);
    const decisions = h.running.daemon.state(runId).groups[0]!.decisions;
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ by: 'human', answer: 'Принято' });
  });
});
