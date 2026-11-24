import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RunRepository } from '../../src/feature/runs/repositories/index.ts';
import type { Attempt } from '../../src/feature/runs/types/index.ts';
import type { LessonSummaryView } from '../../src/presentation/ipc/contract/index.ts';
import { run as seedRun } from '../feature/runs/helpers.ts';
import { harness, startRun, type Harness } from './harness.ts';

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

function fakeLines(h: Harness, file: string): Record<string, any>[] {
  const path = join(h.fakeState, file);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, any>);
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    seq: 1,
    stepId: 'code',
    stepIndex: 0,
    round: 1,
    specialist: 'coder',
    runtime: 'claude',
    model: 'sonnet',
    generation: null,
    status: 'finished',
    input: {
      prompt: 'do it',
      groupTitle: 'Group 1',
      stepId: 'code',
      specialistName: 'Coder',
      skills: [],
      previous: [],
      feedback: null,
      humanAnswer: null,
      decisions: [],
    },
    resumeSession: null,
    sessionId: null,
    report: { verdict: 'done', summary: 'done', feedback: null },
    reason: null,
    startedAt: 10,
    finishedAt: 20,
    usage: null,
    proposal: null,
    denials: [],
    outsideChanges: [],
    ...overrides,
  };
}

/** A finished run of the repository whose coder had a denied tool call: a lesson for later attempts. */
function seedLesson(h: Harness): string {
  const state = seedRun(1, { id: 'seeded-lessons-run' });
  state.run.repository = h.repo;
  state.run.number = 7;
  state.run.finishedAt = Date.now();
  state.groups[0]!.attempts.push(
    attempt({
      denials: [{ tool: 'Bash', command: 'rm -rf build' }],
      outsideChanges: ['/tmp/a.ts'],
    }),
  );
  new RunRepository(h.running.application.database).saveRun(state);
  return state.run.id;
}

describe('lessons of earlier runs', () => {
  it('summarises a finished run and gives its lessons to the next attempt as a skill', async () => {
    const h = await harness();
    current = h;
    const seed = seedLesson(h);

    const summary = (await h.call('run_lessons', { runId: seed })) as LessonSummaryView;
    expect(summary.specialists.map((one) => one.specialist)).toEqual(['coder']);
    expect(summary.specialists[0]!.lessons.map((one) => one.kind).sort()).toEqual([
      'denial',
      'outside_changes',
    ]);

    h.script({ code: [{ write: { 'feature.ts': 'export const feature = true;\n' } }] });
    const created = await startRun(h, { repository: h.repo, pipeline: 'feature', task: 'add it' });
    const final = await h.waitFor(created.runId, (view) => view.finished);
    const group = final.groups[0]!;
    const detail = await h.group(created.runId, group.slug);
    const code = detail.attempts.find((one) => one.stepId === 'code');
    const review = detail.attempts.find((one) => one.stepId === 'review');
    const skill = (seq: number): string =>
      join(
        h.repo,
        '.aip',
        'logs',
        created.runId,
        group.slug,
        String(seq),
        'skills',
        '.claude',
        'skills',
        'aip-lessons',
        'SKILL.md',
      );

    expect(existsSync(skill(code!.seq))).toBe(true);
    const text = readFileSync(skill(code!.seq), 'utf8');
    expect(text).toContain('name: aip-lessons');
    expect(text).toContain('Tool calls of `Bash` were denied');
    expect(text).toContain('#7');

    // The reviewer has no lesson of its own: an attempt without lessons stays as it was.
    expect(existsSync(skill(review!.seq))).toBe(false);

    // The attempt got the Skill tool and was told to read the skill, not just a file on disk.
    const calls = fakeLines(h, 'calls.jsonl');
    const codeCall = calls.find((call) => call.step === 'code')!;
    const codeTools = String(codeCall.args[codeCall.args.indexOf('--tools') + 1]).split(',');
    expect(codeTools).toContain('Skill');
    expect(String(codeCall.args[codeCall.args.indexOf('--append-system-prompt') + 1])).toContain(
      'read the skill `aip-lessons`',
    );

    const reviewCall = calls.find((call) => call.step === 'review')!;
    const reviewTools = String(reviewCall.args[reviewCall.args.indexOf('--tools') + 1]).split(',');
    expect(reviewTools).not.toContain('Skill');
    expect(
      String(reviewCall.args[reviewCall.args.indexOf('--append-system-prompt') + 1]),
    ).not.toContain('aip-lessons');
  });
});
