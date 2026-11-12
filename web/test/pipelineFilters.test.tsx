import { describe, expect, it } from 'vitest';

import {
  EMPTY_PIPELINE_FILTER,
  activePipelineFilterCount,
  applyPipelineFilter,
  existingPipelineFilter,
  matchesPipelineSearch,
  savedPipelineFilter,
  specialistsOfPipeline,
  pipelineFilterOptions,
} from '../src/features/pipelines/pipelineFilters.ts';
import type { EditorPipeline } from '../src/shared/api/types.ts';

function pipeline(id: string, overrides: Partial<EditorPipeline> = {}): EditorPipeline {
  return {
    id,
    level: 'project',
    file: `/repo/aip/pipelines/${id}.yaml`,
    revision: `rev-${id}`,
    raw: { steps: [{ id: 'code', specialist: 'coder' }] },
    shared_tags: [],
    own_tags: [],
    sources: {},
    ...overrides,
  };
}

const feature = pipeline('feature', {
  raw: {
    name: 'Доставка фичи',
    steps: [
      { id: 'plan', specialist: 'plan' },
      { id: 'code', specialist: 'coder' },
    ],
  },
  own_tags: ['fast'],
});
const epic = pipeline('epic', {
  raw: { steps: [{ id: 'plan', specialist: 'plan' }], split: { specialist: 'splitter' } },
  shared_tags: ['Backend'],
});
const quick = pipeline('quick', { level: 'global', shared_tags: ['fast'] });
const over = pipeline('over', { level: 'project_over_global', own_tags: ['Backend'] });
const all = [feature, epic, quick, over];

const ids = (entries: EditorPipeline[]) => entries.map((entry) => entry.id);

describe('pipeline filters', () => {
  it('takes the specialists of the steps and of the split once', () => {
    expect(specialistsOfPipeline(epic)).toEqual(['plan', 'splitter']);
    expect(specialistsOfPipeline(feature)).toEqual(['plan', 'coder']);
    expect(specialistsOfPipeline(pipeline('x', { raw: { steps: 'bad' } }))).toEqual([]);
  });

  it('searches the id and the name without case and edge spaces', () => {
    expect(matchesPipelineSearch(feature, '  FEAT ')).toBe(true);
    expect(matchesPipelineSearch(feature, 'доставка')).toBe(true);
    expect(matchesPipelineSearch(epic, 'zzz')).toBe(false);
    expect(matchesPipelineSearch(epic, '  ')).toBe(true);
  });

  it('uses OR inside a list and AND between lists, keeping the order', () => {
    expect(
      ids(applyPipelineFilter(all, { ...EMPTY_PIPELINE_FILTER, tags: ['fast', 'backend'] }, '')),
    ).toEqual(['feature', 'epic', 'quick', 'over']);
    expect(ids(applyPipelineFilter(all, { ...EMPTY_PIPELINE_FILTER, tags: ['fast'] }, ''))).toEqual(
      ['feature', 'quick'],
    );
    expect(
      ids(
        applyPipelineFilter(
          all,
          { ...EMPTY_PIPELINE_FILTER, tags: ['fast'], specialists: ['plan'] },
          '',
        ),
      ),
    ).toEqual(['feature']);
  });

  it('filters by the specialist of the split', () => {
    expect(
      ids(applyPipelineFilter(all, { ...EMPTY_PIPELINE_FILTER, specialists: ['splitter'] }, '')),
    ).toEqual(['epic']);
  });

  it('puts a project override over a shared one into both levels', () => {
    expect(
      ids(applyPipelineFilter(all, { ...EMPTY_PIPELINE_FILTER, level: 'global' }, '')),
    ).toEqual(['quick', 'over']);
    expect(
      ids(applyPipelineFilter(all, { ...EMPTY_PIPELINE_FILTER, level: 'project' }, '')),
    ).toEqual(['feature', 'epic', 'over']);
  });

  it('counts the filters together with the search', () => {
    expect(activePipelineFilterCount(EMPTY_PIPELINE_FILTER)).toBe(0);
    expect(
      activePipelineFilterCount({ level: 'global', tags: ['a', 'b'], specialists: ['plan'] }, 'q'),
    ).toBe(4);
    expect(activePipelineFilterCount(EMPTY_PIPELINE_FILTER, '  ')).toBe(0);
  });

  it('offers the tags and specialists of the pipelines and drops vanished values', () => {
    const options = pipelineFilterOptions(all);
    expect(options.specialists.map((item) => item.value)).toEqual(['coder', 'plan', 'splitter']);
    const named = pipelineFilterOptions(
      all,
      new Map([
        ['coder', 'Кодировщик'],
        ['plan', 'Аналитик'],
      ]),
    ).specialists;
    expect(named).toEqual([
      { value: 'splitter', label: 'splitter' },
      { value: 'plan', label: 'Аналитик' },
      { value: 'coder', label: 'Кодировщик' },
    ]);
    expect(options.tags.map((tag) => tag.name).sort()).toEqual(['Backend', 'fast']);
    expect(
      existingPipelineFilter(
        { level: 'global', tags: ['fast', 'gone'], specialists: ['plan', 'gone'] },
        options,
      ),
    ).toEqual({ level: 'global', tags: ['fast'], specialists: ['plan'] });
  });

  it('reads only the well-formed parts of a saved choice', () => {
    expect(savedPipelineFilter(null)).toEqual(EMPTY_PIPELINE_FILTER);
    expect(savedPipelineFilter({ level: 'x', tags: ['a', 3], specialists: 'plan' })).toEqual({
      level: 'all',
      tags: ['a'],
      specialists: [],
    });
    expect(savedPipelineFilter({ level: 'project', tags: ['a'], specialists: ['b'] })).toEqual({
      level: 'project',
      tags: ['a'],
      specialists: ['b'],
    });
  });
});
