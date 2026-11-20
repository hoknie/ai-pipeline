import { describe, expect, it } from 'vitest';

import { transition } from '../../../src/feature/runs/machine/index.ts';
import { temporaryStorage } from '../storage.ts';
import { run } from './helpers.ts';

const pin = (version: string, connection = 'c1') => ({ version, connection });

describe('skills_pinned', () => {
  it('fixes the versions of the run with no effects', () => {
    const state = run(1);
    expect(state.run.pinnedSkills).toBeUndefined();
    const effects = transition(
      state,
      { kind: 'skills_pinned', pins: { 'go-testing': pin('1.4.1') } },
      10,
    );
    expect(effects).toEqual([]);
    expect(state.run.pinnedSkills).toEqual({ 'go-testing': pin('1.4.1') });
  });

  it('keeps the first version of a name and adds the new names', () => {
    const state = run(1);
    transition(state, { kind: 'skills_pinned', pins: { 'go-testing': pin('1.4.1') } }, 10);
    transition(
      state,
      { kind: 'skills_pinned', pins: { 'go-testing': pin('1.5.0'), sql: pin('2.0.0', 'c2') } },
      20,
    );
    expect(state.run.pinnedSkills).toEqual({
      'go-testing': pin('1.4.1'),
      sql: pin('2.0.0', 'c2'),
    });
  });

  it('survives a save and a load; a run from before has no pins', () => {
    const store = temporaryStorage();
    const state = run(1);
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.pinnedSkills).toBeUndefined();
    transition(state, { kind: 'skills_pinned', pins: { 'go-testing': pin('1.4.1') } }, 10);
    store.runs.saveRun(state);
    expect(store.runs.loadRun(state.run.id)?.run.pinnedSkills).toEqual({
      'go-testing': pin('1.4.1'),
    });
    store.database
      .prepare('UPDATE runs SET pinned_skills_json = NULL WHERE id = ?')
      .run(state.run.id);
    expect('pinnedSkills' in store.runs.loadRun(state.run.id)!.run).toBe(false);
    store.database.close();
  });
});

describe('pinned skills in the view of a run', () => {
  it('lists the versions in the view and in the text of the CLI, and says nothing before the first', async () => {
    const { runView } = await import('../../../src/presentation/ipc/views/index.ts');
    const { formatRun } = await import('../../../src/presentation/format/index.ts');
    const state = run(1);
    expect(runView(state, 2000).pinnedSkills).toEqual([]);
    expect(formatRun(runView(state, 2000), 2000)).not.toContain('Skills:');
    transition(state, { kind: 'skills_pinned', pins: { 'go-testing': pin('1.4.1') } }, 10);
    const view = runView(state, 2000);
    expect(view.pinnedSkills).toEqual([{ name: 'go-testing', version: '1.4.1' }]);
    expect(formatRun(view, 2000)).toContain('Skills: go-testing 1.4.1');
  });
});
