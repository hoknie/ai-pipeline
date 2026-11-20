import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  DEVELOPER_EXCLUDED,
  actionsMatching,
  isAction,
  patternMatches,
  presetRules,
  similarActions,
} from '../../../src/feature/access/types/index.ts';

describe('the catalog of actions', () => {
  it('names every action once, with a description and a kind of resource', () => {
    const names = ACTIONS.map((action) => action.name);
    expect(new Set(names).size).toBe(names.length);
    for (const action of ACTIONS) {
      expect(action.description.length).toBeGreaterThan(5);
      expect(['global', 'project', 'run', 'task']).toContain(action.resource);
    }
    expect(isAction('run.cancel')).toBe(true);
    expect(isAction('run.destroy')).toBe(false);
  });

  it('matches patterns with `*` over dots', () => {
    expect(patternMatches('*', 'run.cancel')).toBe(true);
    expect(patternMatches('run.*', 'run.cancel')).toBe(true);
    expect(patternMatches('run.*', 'queue.add')).toBe(false);
    expect(patternMatches('*.read', 'project.read')).toBe(true);
    expect(patternMatches('*.read', 'project.readme')).toBe(false);
    expect(patternMatches('config.*.write', 'config.global.write')).toBe(true);
    expect(patternMatches('run.cancel', 'run.cancel')).toBe(true);
    expect(actionsMatching('queue.*').every((name) => name.startsWith('queue.'))).toBe(true);
  });

  it('names close actions for an unknown one', () => {
    expect(similarActions('run.destroy')).toContain('run.cancel');
    expect(similarActions('nothing-like-it').length).toBeGreaterThan(0);
  });
});

describe('the presets of the roles', () => {
  const rule = (id: string) => presetRules().find((item) => item.id === id)!;

  it('give `admin` everything', () => {
    expect(rule('preset:admin').actions).toEqual(['*']);
  });

  it('keep the shared actions from `developer`', () => {
    const developer = rule('preset:developer').actions;
    for (const name of DEVELOPER_EXCLUDED) expect(developer).not.toContain(name);
    expect(developer).toContain('run.apply');
    expect(developer).toContain('queue.add');
    expect(developer).toContain('config.write');
  });

  it('give `viewer` the reading actions only', () => {
    const viewer = rule('preset:viewer').actions;
    expect(viewer).toContain('project.read');
    expect(viewer.every((name) => name.endsWith('.read'))).toBe(true);
    expect(viewer).not.toContain('audit.read');
  });
});
