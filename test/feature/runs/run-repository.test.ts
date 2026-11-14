import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { databasePath, ensureDirectory } from '../../../src/platform/paths/index.ts';
import { SCHEMA_VERSION } from '../../../src/platform/sqlite/index.ts';
import { recoverRuns } from '../../../src/feature/runs/services/index.ts';
import { maxTaskNumber, openStorage, temporaryStorage, renameBack } from '../../feature/storage.ts';
import { finish, run, step } from '../../feature/runs/helpers.ts';
import { addItem, emptyQueue } from '../../../src/feature/queue/types/index.ts';
import { dispatch, transition } from '../../../src/feature/runs/machine/index.ts';

describe('configuration snapshot of a run', () => {
  it('keeps a changed delivery.auto after a repeated save', () => {
    const store = temporaryStorage();
    const state = run(1);
    state.run.config.delivery.auto = true;
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.config.delivery.auto).toBe(true);
    transition(state, { kind: 'auto_delivery_cancelled' }, 10);
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.config.delivery.auto).toBe(false);
  });
});

describe('hold of a run and priority runs', () => {
  it('keeps the hold of a run and the priority list of a queue', () => {
    const store = temporaryStorage();
    const state = run(1);
    state.run.hold = 'frozen';
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.hold).toBe('frozen');
    state.run.hold = null;
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.hold).toBeNull();
    const queue = emptyQueue('/repo', 1);
    queue.priority = ['r1', 'r2'];
    store.queues.saveQueue(queue);
    expect(store.queues.loadQueue('/repo')?.priority).toEqual(['r1', 'r2']);
  });

  it('reads an older database with no hold and an empty priority list', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const old = openStorage(databasePath(directory));
    const state = run(1);
    old.runs.saveRun(state);
    old.queues.saveQueue(emptyQueue('/repo', 1));
    old.database.exec('ALTER TABLE runs DROP COLUMN hold');
    old.database.exec('ALTER TABLE queues DROP COLUMN auto_answer');
    old.database.exec('ALTER TABLE queues DROP COLUMN priority_json');
    old.database.exec('DROP TABLE run_patches');
    old.database.exec('ALTER TABLE groups DROP COLUMN human_only');
    old.database.exec('ALTER TABLE runs DROP COLUMN repair_json');
    old.database.exec('DROP TABLE observers');
    renameBack(old.database.connection);
    old.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 7 - (7 + 1)}`);
    old.database.close();
    const store = openStorage(databasePath(directory));
    expect(store.runs.loadRun(state.run.id)?.run.hold).toBeNull();
    expect(store.queues.loadQueue('/repo')?.priority).toEqual([]);
  });
});

describe('runs', () => {
  it('keeps the variant of a run after a restart', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const first = openStorage(databasePath(directory));
    const state = run(1);
    state.run.variant = 'light';
    first.runs.saveRun(state);
    first.database.close();
    const second = openStorage(databasePath(directory));
    expect(second.runs.loadRun(state.run.id)?.run.variant).toBe('light');
    second.database.close();
  });

  it('restores a snapshot written before agy without changing its specialists', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    const { agy: _absent, ...runtimes } = state.run.config.runtimes;
    store.database
      .prepare('UPDATE runs SET config_json = ? WHERE id = ?')
      .run(JSON.stringify({ ...state.run.config, runtimes }), state.run.id);
    const loaded = store.runs.loadRun(state.run.id)!;
    expect(loaded.run.config.specialists).toEqual(state.run.config.specialists);
    expect(loaded.run.config.runtimes.agy).toEqual({
      command: 'agy',
      enabled: null,
      args: [],
      env: {},
    });
    store.database.close();
  });

  it.each([false, true])(
    'restores model options, including an old snapshot (explicit: %s)',
    (explicit) => {
      const store = temporaryStorage();
      const state = run(1);
      const coder = state.run.config.specialists.find((item) => item.slug === 'coder')!;
      if (explicit) {
        coder.variant = 'company-deep';
        coder.reasoningEffort = 'xhigh';
      }
      store.runs.saveRun(state);
      const restored = store.runs
        .loadRun(state.run.id)!
        .run.config.specialists.find((item) => item.slug === 'coder')!;
      expect(restored).toEqual(coder);
      if (explicit)
        expect(restored).toMatchObject({ variant: 'company-deep', reasoningEffort: 'xhigh' });
      else {
        expect(restored).not.toHaveProperty('variant');
        expect(restored).not.toHaveProperty('reasoningEffort');
      }
    },
  );

  it('reads back exactly what it saved', () => {
    const store = temporaryStorage();
    const state = run(2);
    step(state);
    finish(state, 'done', { summary: 'план' });
    step(state);
    finish(state, 'rejected', { slug: 'gruppa-2', feedback: 'нет' });
    state.groups[0]!.attempts.at(-1)!.usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.01 };
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)).toEqual(state);
  });

  it('keeps structured questions of a group waiting for a human', () => {
    const store = temporaryStorage();
    const state = run(1);
    step(state);
    const questions = [
      { text: 'OAuth или пароль?', options: ['OAuth', 'пароль'], recommendation: 'OAuth' },
      { text: 'Где хранить?' },
    ];
    finish(state, 'needs_human', { questions });
    store.runs.saveRun(state);
    const loaded = store.runs.loadRun(state.run.id)!;
    expect(loaded.groups[0]!.questions).toEqual(questions);
    expect(loaded).toEqual(state);
  });

  it('keeps the human-only mark of a group and reads an unknown value as none', () => {
    const store = temporaryStorage();
    const state = run(1);
    step(state);
    finish(state, 'needs_human', { feedback: 'Глянь', humanOnly: true });
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.humanOnly).toBe('request');
    state.groups[0]!.humanOnly = 'review';
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.humanOnly).toBe('review');
    store.database.exec("UPDATE groups SET human_only = 'bogus'");
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.humanOnly).toBeNull();
    store.database.exec('UPDATE groups SET human_only = NULL');
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.humanOnly).toBeNull();
  });

  it('keeps the title, the name and the usage of naming', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    transition(
      state,
      {
        kind: 'run_named',
        title: 'Флаг --json',
        name: 'add-json-flag',
        usage: { inputTokens: 30, outputTokens: 10, costUsd: 0.002 },
      },
      60,
    );
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run).toMatchObject({
      title: 'Флаг --json',
      name: 'add-json-flag',
      namingUsage: { inputTokens: 30, outputTokens: 10, costUsd: 0.002 },
    });
  });

  it('updates a run after a transition', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    step(state);
    store.runs.saveRun(state);
    transition(state, { kind: 'cancel', group: null }, 50);
    store.runs.saveRun(state);
    const loaded = store.runs.loadRun(state.run.id);
    expect(loaded?.groups[0]?.status).toBe('cancelled');
    expect(loaded?.run.finishedAt).toBe(50);
    expect(store.runs.loadRun('missing')).toBeNull();
  });

  it('fails attempts that were running when the daemon stopped and keeps the queue', () => {
    const store = temporaryStorage();
    const state = run(2, { max: 1 });
    step(state);
    store.runs.saveRun(state);
    recoverRuns(store.database, store.runs, 99);
    const loaded = store.runs.loadRun(state.run.id)!;
    expect(loaded.groups[0]).toMatchObject({ status: 'failed', reason: 'interrupted' });
    expect(loaded.groups[0]?.attempts[0]?.reason).toEqual({ kind: 'interrupted' });
    expect(loaded.groups[1]?.status).toBe('queued');
    expect(store.runs.activeRuns().map((active) => active.run.id)).toEqual([state.run.id]);
  });

  it('starts again the delivery of a finished run cut off by a restart', () => {
    const store = temporaryStorage();
    const state = run(1);
    for (const _ of ['plan', 'code', 'review', 'qa']) {
      step(state);
      finish(state, 'done');
    }
    const merged = transition(
      state,
      { kind: 'merge_finished', group: 'gruppa-1', outcome: { kind: 'merged', commit: 'c' } },
      60,
    );
    expect(merged).toEqual([expect.objectContaining({ kind: 'deliver', auto: true })]);
    expect(state.run.finishedAt).toBe(60);
    store.runs.saveRun(state);
    const recovered = recoverRuns(store.database, store.runs, 99);
    expect(recovered.map(({ state: each }) => each.run.id)).toEqual([state.run.id]);
    expect(recovered[0]?.effects).toEqual([
      expect.objectContaining({ kind: 'deliver', groups: ['gruppa-1'], auto: true }),
    ]);
    expect(store.runs.loadRun(state.run.id)?.run.pendingDelivery).toMatchObject({ auto: true });
  });

  it('lists finished runs by finish time, the latest first, without active ones', () => {
    const store = temporaryStorage();
    for (const [id, at] of [
      ['finished0001', 300],
      ['finished0002', 500],
      ['finished0003', 400],
    ] as const) {
      const finished = run(1, { id, now: 100 });
      transition(finished, { kind: 'cancel', group: null }, at);
      store.runs.saveRun(finished);
    }
    store.runs.saveRun(run(1, { id: 'activerun001', now: 50 }));
    expect(store.finished.finishedRuns().map((state) => state.run.id)).toEqual([
      'finished0002',
      'finished0003',
      'finished0001',
    ]);
  });

  it('lists active runs and the ten latest finished ones', () => {
    const store = temporaryStorage();
    for (let index = 0; index < 12; index += 1) {
      const finished = run(1, {
        id: `finished${String(index).padStart(4, '0')}`,
        now: 100 + index,
      });
      transition(finished, { kind: 'cancel', group: null }, 200);
      store.runs.saveRun(finished);
    }
    store.runs.saveRun(run(1, { id: 'activerun001', now: 50 }));
    const recent = store.finished.recentRuns().map((state) => state.run.id);
    expect(recent).toHaveLength(11);
    expect(recent[0]).toBe('activerun001');
    expect(recent[1]).toBe('finished0011');
    expect(recent.at(-1)).toBe('finished0002');
  });
});

describe('split persistence', () => {
  it('stores the split group, proposals and warnings', () => {
    const store = temporaryStorage();
    const state = run(1, {
      split: true,
      configText: `swarm:
  specialists:
    plan: { name: P }
  pipelines:
    feature:
      split: { specialist: plan }
      steps:
        - { id: plan, specialist: plan }
`,
    });
    step(state);
    transition(state, { kind: 'split_proposed', seq: 1, groups: [{ title: 'A', task: 'a' }] }, 5);
    state.split!.warnings.push('w');
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)).toEqual(state);
  });
});

describe('run hold', () => {
  it('keeps the hold of a run', () => {
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    const state = run(1);
    expect(state.run.hold).toBeNull();
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.run.hold).toBeNull();
    state.run.hold = 'paused';
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.run.hold).toBe('paused');
    store.database.close();
  });
});

describe('refused tool calls', () => {
  it('keeps the denials of an attempt and reads older attempts as none', async () => {
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    const state = run(1);
    step(state);
    const attempt = state.groups[0]!.attempts[0]!;
    attempt.denials = [{ tool: 'Bash', command: 'python3 fix.py' }];
    store.runs.saveRun(state);
    // As a database written before the column existed.
    renameBack(store.database.connection);
    store.database.exec(
      'DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json; ALTER TABLE groups DROP COLUMN human_only; ALTER TABLE groups DROP COLUMN questions_json; DROP TABLE repositories; DROP TABLE queue_items; DROP TABLE queues; ALTER TABLE runs DROP COLUMN queue_item; ALTER TABLE runs DROP COLUMN from_queue; ALTER TABLE attempts DROP COLUMN denials_json; ALTER TABLE attempts DROP COLUMN outside_changes_json; ALTER TABLE runs DROP COLUMN skipped_steps_json; ALTER TABLE runs DROP COLUMN number; ALTER TABLE runs DROP COLUMN hold; ALTER TABLE runs DROP COLUMN repair_json; DROP TABLE observers; PRAGMA user_version = 3',
    );
    store.database.close();
    const reopened = openStorage(databasePath(directory));
    expect(reopened.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!.denials).toEqual([]);
    reopened.runs.saveRun(state);
    expect(reopened.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!.denials).toEqual([
      { tool: 'Bash', command: 'python3 fix.py' },
    ]);
    reopened.database.close();
    expect(MIGRATIONS.at(-31)).toContain('denials_json');
  });

  it('keeps the files an attempt changed outside its worktree and reads older attempts as none', async () => {
    const { MIGRATIONS } = await import('../../../src/platform/sqlite/index.ts');
    const directory = ensureDirectory(join(mkdtempSync(join(tmpdir(), 'aip-store-')), 'aip'));
    const store = openStorage(databasePath(directory));
    const state = run(1);
    step(state);
    state.groups[0]!.attempts[0]!.outsideChanges = ['README.md', 'docs/a.md'];
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!.outsideChanges).toEqual([
      'README.md',
      'docs/a.md',
    ]);
    // As a database written before the column existed.
    renameBack(store.database.connection);
    store.database.exec(
      'DROP TABLE tags; ALTER TABLE runs DROP COLUMN tags_json; ALTER TABLE groups DROP COLUMN human_only; ALTER TABLE groups DROP COLUMN questions_json; DROP TABLE repositories; DROP TABLE queue_items; DROP TABLE queues; ALTER TABLE runs DROP COLUMN queue_item; ALTER TABLE runs DROP COLUMN from_queue; ALTER TABLE attempts DROP COLUMN outside_changes_json; ALTER TABLE runs DROP COLUMN skipped_steps_json; ALTER TABLE runs DROP COLUMN number; ALTER TABLE runs DROP COLUMN hold; ALTER TABLE runs DROP COLUMN repair_json; DROP TABLE observers; PRAGMA user_version = 4',
    );
    store.database.close();
    const reopened = openStorage(databasePath(directory));
    expect(reopened.runs.loadRun(state.run.id)!.groups[0]!.attempts[0]!.outsideChanges).toEqual([]);
    reopened.database.close();
    expect(MIGRATIONS.at(-30)).toContain('outside_changes_json');
  });
});

describe('delivery time of a group', () => {
  it('reads an old delivery_json without finishedAt as null and keeps a stored one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const store = openStorage(databasePath(directory));
    const state = run(1);
    state.groups[0]!.delivery = { ...state.groups[0]!.delivery, state: 'apply_failed' };
    store.runs.saveRun(state);
    const { finishedAt: _omit, ...old } = state.groups[0]!.delivery;
    store.database
      .prepare('UPDATE groups SET delivery_json = ? WHERE run_id = ?')
      .run(JSON.stringify(old), state.run.id);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.delivery.finishedAt).toBeNull();
    state.groups[0]!.delivery.finishedAt = 1234;
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.delivery.finishedAt).toBe(1234);
    store.database.close();
  });
});

describe('manual delivery mark of a group', () => {
  it('reads a delivery_json without manual as false and keeps a stored true', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aip-store-'));
    const store = openStorage(databasePath(directory));
    const state = run(1);
    state.groups[0]!.delivery = { ...state.groups[0]!.delivery, state: 'applied', manual: true };
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.delivery.manual).toBe(true);
    const { manual: _omit, ...old } = state.groups[0]!.delivery;
    store.database
      .prepare('UPDATE groups SET delivery_json = ? WHERE run_id = ?')
      .run(JSON.stringify(old), state.run.id);
    expect(store.runs.loadRun(state.run.id)!.groups[0]!.delivery).toMatchObject({
      state: 'applied',
      manual: false,
    });
    store.database.close();
  });
});

describe('finishedRunsPage', () => {
  function finished(id: string, now: number, done: boolean) {
    const state = run(1, { id, now });
    if (done) state.run.finishedAt = now + 1;
    return state;
  }

  it('pages finished runs by the (created_at, id) cursor without repeats', () => {
    const store = temporaryStorage();
    store.runs.saveRun(finished('run000000001', 10, true));
    store.runs.saveRun(finished('run000000002', 20, true));
    store.runs.saveRun(finished('run000000003', 20, true));
    store.runs.saveRun(finished('run000000004', 30, true));
    store.runs.saveRun(finished('run000000005', 40, false));
    const first = store.finished.finishedRunsPage(2);
    expect(first.runs.map((state) => state.run.id)).toEqual(['run000000004', 'run000000003']);
    expect(first.more).toBe(true);
    const last = first.runs.at(-1)!.run;
    const second = store.finished.finishedRunsPage(2, { createdAt: last.createdAt, id: last.id });
    expect(second.runs.map((state) => state.run.id)).toEqual(['run000000002', 'run000000001']);
    expect(second.more).toBe(false);
    store.database.close();
  });

  it('pages the finished runs of one repository only', () => {
    const store = temporaryStorage();
    for (const [id, now, repository] of [
      ['run000000001', 10, '/repo'],
      ['run000000002', 20, '/other'],
      ['run000000003', 30, '/repo'],
      ['run000000004', 40, '/other'],
      ['run000000005', 50, '/repo'],
    ] as const) {
      const state = finished(id, now, true);
      state.run.repository = repository;
      store.runs.saveRun(state);
    }
    const first = store.finished.finishedRunsPage(2, undefined, '/repo');
    expect(first.runs.map((state) => state.run.id)).toEqual(['run000000005', 'run000000003']);
    expect(first.more).toBe(true);
    const last = first.runs.at(-1)!.run;
    const second = store.finished.finishedRunsPage(
      2,
      { createdAt: last.createdAt, id: last.id },
      '/repo',
    );
    expect(second.runs.map((state) => state.run.id)).toEqual(['run000000001']);
    expect(second.more).toBe(false);
    expect(store.finished.finishedRunsPage(2, undefined, '/none')).toEqual({
      runs: [],
      more: false,
    });
    store.database.close();
  });
});

describe('runs with pipeline actions', () => {
  const ACTIONS_CONFIG = `swarm:
  specialists:
    plan: { name: Планировщик }
    coder: { name: Кодировщик }
  actions:
    prepare: { run: make }
    commit: { run: commit }
  stages:
    before_split: [prepare]
    after_delivery: [commit]
  pipelines:
    feature:
      split: { specialist: plan }
      steps:
        - { id: code, specialist: coder }
`;

  it('saves and loads the groups of the actions apart from the groups of work', () => {
    const store = temporaryStorage();
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    state.actions[0]!.status = 'failed';
    state.actions[0]!.reason = 'exit code 3';
    store.runs.saveRun(state);
    const loaded = store.runs.loadRun(state.run.id);
    expect(loaded?.actions.map((group) => [group.slug, group.status, group.reason])).toEqual([
      ['_action-before-split-prepare', 'failed', 'exit code 3'],
    ]);
    expect(loaded?.groups).toEqual([]);
    expect(loaded?.split?.slug).toBe('_split');
    store.database.close();
  });

  it('keeps the attempts of a command and the delivery message', () => {
    const store = temporaryStorage();
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    const action = state.actions[0]!;
    action.attempts.push({
      seq: 1,
      stepId: 'prepare',
      stepIndex: 0,
      round: 1,
      specialist: 'prepare',
      runtime: 'command',
      model: null,
      status: 'failed',
      input: {
        prompt: 'make',
        groupTitle: 'prepare',
        stepId: 'prepare',
        specialistName: 'prepare',
        skills: [],
        previous: [],
        feedback: null,
        humanAnswer: null,
        decisions: [],
      },
      resumeSession: null,
      sessionId: null,
      report: null,
      reason: { kind: 'exit_code', code: 3 },
      startedAt: 1,
      finishedAt: 2,
      usage: null,
      proposal: null,
      denials: [],
      outsideChanges: [],
    });
    store.runs.saveRun(state);
    const loaded = store.runs.loadRun(state.run.id);
    expect(loaded?.actions[0]?.attempts[0]).toMatchObject({
      runtime: 'command',
      reason: { kind: 'exit_code', code: 3 },
    });
    store.database.close();
  });

  it('marks a command that was running as interrupted when the daemon starts', () => {
    const store = temporaryStorage();
    const state = run(1, { split: true, configText: ACTIONS_CONFIG });
    dispatch([state], 1500);
    expect(state.actions[0]?.status).toBe('running');
    store.runs.saveRun(state);
    const [recovered] = recoverRuns(store.database, store.runs, 5000);
    const action = recovered?.state.actions[0];
    expect(action?.status).toBe('failed');
    expect(action?.reason).toBe('interrupted');
    expect(recovered?.effects).toEqual([]);
    store.database.close();
  });

  it('loads a run saved before the actions existed', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    const loaded = store.runs.loadRun(state.run.id);
    expect(loaded?.actions).toEqual([]);
    expect(loaded?.run.config.actions).toEqual([]);
    store.database.close();
  });
});

describe('next task number', () => {
  const emptyOf = (repository: string) => emptyQueue(repository, 1);

  it('comes from the runs when only they have a number', () => {
    const store = temporaryStorage();
    store.runs.saveRun(run(1, { id: 'run000000001' }));
    expect(store.runs.maxNumber('/repo')).toBeGreaterThan(0);
    expect(store.queues.maxItemNumber('/repo')).toBe(0);
    expect(maxTaskNumber(store, '/repo')).toBe(store.runs.maxNumber('/repo'));
    store.database.close();
  });

  it('comes from the queue items when only they have a number', () => {
    const store = temporaryStorage();
    const queue = emptyOf('/repo');
    addItem(queue, { pipeline: 'feature', task: 'A' }, 'q1', 1);
    addItem(queue, { pipeline: 'feature', task: 'B' }, 'q2', 2);
    store.queues.saveQueue(queue);
    expect(store.runs.maxNumber('/repo')).toBe(0);
    expect(store.queues.maxItemNumber('/repo')).toBe(2);
    expect(maxTaskNumber(store, '/repo')).toBe(2);
    store.database.close();
  });

  it('is zero when there is nothing, and does not mix repositories', () => {
    const store = temporaryStorage();
    store.runs.saveRun(run(1, { id: 'run000000001' }));
    expect(maxTaskNumber(store, '/nowhere')).toBe(0);
    store.database.close();
  });
});

describe('attachments of a run', () => {
  it('keeps the snapshot of the attachments and reads an older run as having none', () => {
    const store = temporaryStorage();
    const state = run(1);
    expect(store.runs.loadRun(state.run.id)).toBeNull();
    state.run.attachments = [
      { id: 'a1', fileName: 'shot.png', size: 2048, mediaType: 'image/png' },
    ];
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.attachments).toEqual(state.run.attachments);
    // a repeated save does not change the snapshot
    state.run.attachments = [];
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.attachments).toHaveLength(1);
    store.database.close();
  });
});
