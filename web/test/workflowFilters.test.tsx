import { describe, expect, it } from 'vitest';

import {
  EMPTY_WORKFLOW_FILTER,
  activeWorkflowFilterCount,
  applyWorkflowFilter,
  existingWorkflowFilter,
  matchesWorkflowSearch,
  savedWorkflowFilter,
  specialistsOfWorkflow,
  workflowFilterOptions,
} from '../src/workflowFilters.ts';
import type { EditorWorkflow } from '../src/types.ts';

function workflow(id: string, overrides: Partial<EditorWorkflow> = {}): EditorWorkflow {
  return {
    id,
    level: 'project',
    file: `/repo/aip/workflows/${id}.yaml`,
    revision: `rev-${id}`,
    raw: { steps: [{ id: 'code', specialist: 'coder' }] },
    shared_tags: [],
    own_tags: [],
    sources: {},
    ...overrides,
  };
}

const feature = workflow('feature', {
  raw: {
    name: 'Доставка фичи',
    steps: [
      { id: 'plan', specialist: 'plan' },
      { id: 'code', specialist: 'coder' },
    ],
  },
  own_tags: ['fast'],
});
const epic = workflow('epic', {
  raw: { steps: [{ id: 'plan', specialist: 'plan' }], split: { specialist: 'splitter' } },
  shared_tags: ['Backend'],
});
const quick = workflow('quick', { level: 'global', shared_tags: ['fast'] });
const over = workflow('over', { level: 'project_over_global', own_tags: ['Backend'] });
const all = [feature, epic, quick, over];

const ids = (entries: EditorWorkflow[]) => entries.map((entry) => entry.id);

describe('pipeline filters', () => {
  it('takes the specialists of the steps and of the split once', () => {
    expect(specialistsOfWorkflow(epic)).toEqual(['plan', 'splitter']);
    expect(specialistsOfWorkflow(feature)).toEqual(['plan', 'coder']);
    expect(specialistsOfWorkflow(workflow('x', { raw: { steps: 'bad' } }))).toEqual([]);
  });

  it('searches the id and the name without case and edge spaces', () => {
    expect(matchesWorkflowSearch(feature, '  FEAT ')).toBe(true);
    expect(matchesWorkflowSearch(feature, 'доставка')).toBe(true);
    expect(matchesWorkflowSearch(epic, 'zzz')).toBe(false);
    expect(matchesWorkflowSearch(epic, '  ')).toBe(true);
  });

  it('uses OR inside a list and AND between lists, keeping the order', () => {
    expect(
      ids(applyWorkflowFilter(all, { ...EMPTY_WORKFLOW_FILTER, tags: ['fast', 'backend'] }, '')),
    ).toEqual(['feature', 'epic', 'quick', 'over']);
    expect(ids(applyWorkflowFilter(all, { ...EMPTY_WORKFLOW_FILTER, tags: ['fast'] }, ''))).toEqual(
      ['feature', 'quick'],
    );
    expect(
      ids(
        applyWorkflowFilter(
          all,
          { ...EMPTY_WORKFLOW_FILTER, tags: ['fast'], specialists: ['plan'] },
          '',
        ),
      ),
    ).toEqual(['feature']);
  });

  it('filters by the specialist of the split', () => {
    expect(
      ids(applyWorkflowFilter(all, { ...EMPTY_WORKFLOW_FILTER, specialists: ['splitter'] }, '')),
    ).toEqual(['epic']);
  });

  it('puts a project override over a shared one into both levels', () => {
    expect(
      ids(applyWorkflowFilter(all, { ...EMPTY_WORKFLOW_FILTER, level: 'global' }, '')),
    ).toEqual(['quick', 'over']);
    expect(
      ids(applyWorkflowFilter(all, { ...EMPTY_WORKFLOW_FILTER, level: 'project' }, '')),
    ).toEqual(['feature', 'epic', 'over']);
  });

  it('counts the filters together with the search', () => {
    expect(activeWorkflowFilterCount(EMPTY_WORKFLOW_FILTER)).toBe(0);
    expect(
      activeWorkflowFilterCount({ level: 'global', tags: ['a', 'b'], specialists: ['plan'] }, 'q'),
    ).toBe(4);
    expect(activeWorkflowFilterCount(EMPTY_WORKFLOW_FILTER, '  ')).toBe(0);
  });

  it('offers the tags and specialists of the pipelines and drops vanished values', () => {
    const options = workflowFilterOptions(all);
    expect(options.specialists).toEqual(['coder', 'plan', 'splitter']);
    expect(options.tags.map((tag) => tag.name).sort()).toEqual(['Backend', 'fast']);
    expect(
      existingWorkflowFilter(
        { level: 'global', tags: ['fast', 'gone'], specialists: ['plan', 'gone'] },
        options,
      ),
    ).toEqual({ level: 'global', tags: ['fast'], specialists: ['plan'] });
  });

  it('reads only the well-formed parts of a saved choice', () => {
    expect(savedWorkflowFilter(null)).toEqual(EMPTY_WORKFLOW_FILTER);
    expect(savedWorkflowFilter({ level: 'x', tags: ['a', 3], specialists: 'plan' })).toEqual({
      level: 'all',
      tags: ['a'],
      specialists: [],
    });
    expect(savedWorkflowFilter({ level: 'project', tags: ['a'], specialists: ['b'] })).toEqual({
      level: 'project',
      tags: ['a'],
      specialists: ['b'],
    });
  });
});
