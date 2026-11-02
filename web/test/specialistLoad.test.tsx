import { describe, expect, it } from 'vitest';

import { loadSections, machineLoad } from '../src/specialistLoad.ts';

import { runView, specialistUse } from './fixtures.ts';

const APP = '/work/app';
const LIB = '/work/lib';

describe('machineLoad', () => {
  it('is empty without runs and ignores finished runs', () => {
    expect(machineLoad([]).size).toBe(0);
    const finished = runView({
      finished: true,
      specialists: [specialistUse('coder', { running: ['a'] })],
    });
    expect(machineLoad([finished]).size).toBe(0);
  });

  it('adds up one global specialist over two repositories', () => {
    const load = machineLoad([
      runView({
        id: 'r1',
        title: 'Первый',
        repository: APP,
        specialists: [specialistUse('coder', { level: 'global', max: 1, running: ['login'] })],
      }),
      runView({
        id: 'r2',
        title: 'Второй',
        repository: LIB,
        workflow: 'epic',
        specialists: [specialistUse('coder', { level: 'global', max: 1, waiting: ['api'] })],
      }),
    ]);
    const coder = load.get('coder')!;
    expect(coder.max).toBe(1);
    expect(coder.running).toMatchObject([
      { runId: 'r1', runTitle: 'Первый', repository: APP, workflow: 'feature', group: 'login' },
    ]);
    expect(coder.waiting).toMatchObject([
      { runId: 'r2', repository: LIB, workflow: 'epic', group: 'api', status: 'queued' },
    ]);
    const sections = loadSections(load, LIB);
    expect(sections.project).toEqual([]);
    expect(sections).toMatchObject({ running: 1, waiting: 1 });
    expect(sections.global).toHaveLength(1);
    expect(sections.global[0]).toMatchObject({ specialist: 'coder', running: 1, waiting: 1 });
    // the selected repository comes first
    expect(sections.global[0]?.repositories.map((use) => use.repository)).toEqual([LIB, APP]);
  });

  it('groups project specialists by repository, the selected one first', () => {
    const load = machineLoad([
      runView({
        id: 'r1',
        repository: APP,
        specialists: [
          specialistUse('coder', { running: ['a'] }),
          specialistUse('plan', { waiting: ['b'] }),
        ],
      }),
      runView({
        id: 'r2',
        repository: LIB,
        specialists: [specialistUse('coder', { running: ['c'] })],
      }),
    ]);
    const sections = loadSections(load, LIB);
    expect(sections.global).toEqual([]);
    expect(sections.project.map((item) => [item.repository, item.running, item.waiting])).toEqual([
      [LIB, 1, 0],
      [APP, 1, 1],
    ]);
    expect(sections.project[1]?.specialists.map((item) => item.specialist)).toEqual([
      'coder',
      'plan',
    ]);
    // the same slug in another repository is counted on the machine
    expect(sections.project[1]?.specialists[0]).toMatchObject({ totalRunning: 2 });
  });

  it('shows a slug of different levels in both blocks and takes the smallest limit', () => {
    const load = machineLoad([
      runView({
        id: 'r1',
        repository: APP,
        specialists: [specialistUse('coder', { level: 'global', max: 3, running: ['a'] })],
      }),
      runView({
        id: 'r2',
        repository: LIB,
        specialists: [specialistUse('coder', { level: 'project', max: 2, running: ['b'] })],
      }),
      runView({
        id: 'r3',
        repository: '/work/other',
        specialists: [specialistUse('coder', { max: null, waiting: ['c'] })],
      }),
    ]);
    expect(load.get('coder')?.max).toBe(2);
    const sections = loadSections(load, null);
    expect(sections.global.map((item) => item.specialist)).toEqual(['coder']);
    expect(sections.project.map((item) => item.repository)).toEqual([LIB, '/work/other']);
    expect(sections.running).toBe(2);
    expect(sections.waiting).toBe(1);
  });

  it('counts the global row over the whole machine, including project use of the slug', () => {
    const load = machineLoad([
      runView({
        id: 'r1',
        repository: LIB,
        specialists: [specialistUse('coder', { level: 'global', max: 2, running: ['a'] })],
      }),
      runView({
        id: 'r2',
        repository: APP,
        specialists: [specialistUse('coder', { level: 'project', max: 2, running: ['b'] })],
      }),
    ]);
    const sections = loadSections(load, null);
    expect(sections.global[0]).toMatchObject({ specialist: 'coder', max: 2, running: 2 });
    expect(sections.global[0]?.repositories.map((use) => use.repository)).toEqual([LIB]);
  });

  it('gives nothing for specialists nobody uses', () => {
    const load = machineLoad([runView({ specialists: [specialistUse('coder')] })]);
    expect(loadSections(load, null)).toEqual({ global: [], project: [], running: 0, waiting: 0 });
  });
});
