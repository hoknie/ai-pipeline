// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorChain, EditorPipeline } from '../src/shared/api/types.ts';
import { ChainForm } from '../src/features/specialists/chains/ChainForm.tsx';
import { ActionForm } from '../src/features/pipelines/ActionForm.tsx';
import { PipelineForm } from '../src/features/pipelines/form/PipelineForm.tsx';
import { SpecialistForm } from '../src/features/specialists/form/SpecialistForm.tsx';
import { actionEntry, configView, fakeApi, specialistEntry } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor } from './render.tsx';

afterEach(cleanup);

const WRITES = [/^Save/, /^Save as/, /^Override/, /^Make shared/, /^Remove$/, /^Delete$/, /^Reset/];
const fields = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea, select'));

function specialistForm(
  level: 'project' | 'global',
  locked?: boolean,
  overrides: Parameters<typeof specialistEntry>[1] = {},
) {
  const api = fakeApi();
  render(
    <SpecialistForm
      api={api}
      view={configView({})}
      specialist={specialistEntry('qa', {
        level,
        file: '/x/qa.yaml',
        revision: 'r1',
        ...overrides,
      })}
      catalog={null}
      catalogError={null}
      notice={null}
      onDirty={vi.fn()}
      onReload={vi.fn(async () => undefined)}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
      {...(locked === undefined ? {} : { locked })}
    />,
  );
  return api;
}

describe('the form of a specialist with locked', () => {
  it.each(['project', 'global'] as const)('is view only for a %s specialist', (level) => {
    specialistForm(level, true);
    expect(fields().length).toBeGreaterThan(0);
    expect(
      fields()
        .filter((field) => !field.disabled)
        .map((f) => f.outerHTML),
    ).toEqual([]);
    for (const name of WRITES) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByText(/it is view only/)).toBeNull();
  });

  it('has no level switch: the file of the level stays, fields disabled, no writes', () => {
    const api = specialistForm('project', true, {
      sources: {
        project: { file: '/x/qa.yaml', revision: 'r1', raw: { name: 'Project QA' } },
        global: { file: '/g/qa.yaml', revision: 'r2', raw: { name: 'Global QA' } },
      },
    });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Project QA');
    expect(screen.getByText('/x/qa.yaml')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Level' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Global' })).toBeNull();
    expect(fields().filter((field) => !field.disabled)).toEqual([]);
    expect(api.writeSpecialist).not.toHaveBeenCalled();
    expect(api.deleteSpecialist).not.toHaveBeenCalled();
  });

  it('stays editable without locked', () => {
    specialistForm('project');
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

const raw = { name: 'Fast', mode: 'on_error', enabled: true, runtimes: [{ provider: 'zai' }] };
const chain = (level: 'project' | 'global'): EditorChain => ({
  slug: 'fast',
  level,
  file: '/x/fast.yaml',
  revision: level === 'project' ? 'c1' : null,
  raw,
  sources: { [level]: { file: '/x/fast.yaml', revision: 'c1', raw } },
});

function chainForm(level: 'project' | 'global', locked?: boolean) {
  render(
    <ChainForm
      api={fakeApi()}
      chain={chain(level)}
      onDirty={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
      {...(locked === undefined ? {} : { locked })}
    />,
  );
}

describe('the form of a chain with locked', () => {
  it.each(['project', 'global'] as const)('is view only for a %s chain', (level) => {
    chainForm(level, true);
    expect(fields().length).toBeGreaterThan(0);
    expect(
      fields()
        .filter((field) => !field.disabled)
        .map((f) => f.outerHTML),
    ).toEqual([]);
    for (const name of WRITES) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('shows no global hint for a project chain', () => {
    chainForm('project', true);
    expect(screen.queryByText(/global file applies/i)).toBeNull();
  });

  it('stays editable without locked', () => {
    chainForm('project');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

const globalSource = {
  file: '/g/epic.yaml',
  revision: 'g1',
  raw: { name: 'Epic shared', steps: [{ id: 'code', specialist: 'coder' }] },
};
const projectSource = {
  file: '/x/epic.yaml',
  revision: 'p1',
  raw: { name: 'Epic app', steps: [{ id: 'code', specialist: 'coder' }] },
};
const pipelineOf = (level: 'project' | 'global' | 'project_over_global'): EditorPipeline => ({
  id: 'epic',
  level,
  file: level === 'global' ? '/g/epic.yaml' : '/x/epic.yaml',
  revision: 'p1',
  raw: level === 'global' ? globalSource.raw : projectSource.raw,
  shared_tags: [],
  own_tags: [],
  sources: {
    ...(level !== 'global' ? { project: projectSource } : {}),
    ...(level !== 'project' ? { global: globalSource } : {}),
  },
});

function pipelineForm(level: Parameters<typeof pipelineOf>[0], locked?: boolean) {
  const api = fakeApi();
  render(
    <PipelineForm
      api={api}
      view={configView({ specialists: [specialistEntry('coder', {}, { name: 'Coder' })] })}
      pipeline={pipelineOf(level)}
      activeRuns={0}
      notice={null}
      onDirty={vi.fn()}
      onReload={vi.fn(async () => undefined)}
      onSaved={vi.fn(async () => undefined)}
      onDeleted={vi.fn(async () => undefined)}
      {...(locked === undefined ? {} : { locked })}
    />,
  );
  return api;
}

const PIPELINE_CHROME = [...WRITES, /^Edit in settings/, /^Override in project/];

describe('the form of a pipeline with locked', () => {
  it.each(['project', 'global', 'project_over_global'] as const)(
    'is view only for a %s pipeline: no level switch, no hints, no writes',
    (level) => {
      const api = pipelineForm(level, true);
      expect(fields().length).toBeGreaterThan(0);
      expect(fields().filter((field) => !field.disabled)).toEqual([]);
      for (const name of PIPELINE_CHROME) expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.queryByRole('radio', { name: 'Global' })).toBeNull();
      expect(screen.queryByRole('radio', { name: 'Project' })).toBeNull();
      expect(screen.queryByText(/it is view only/)).toBeNull();
      expect(screen.getByRole('tab', { name: 'Form' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: /Diagram/ })).toBeTruthy();
      expect(api.writePipeline).not.toHaveBeenCalled();
      expect(api.deletePipeline).not.toHaveBeenCalled();
    },
  );

  it('keeps the file of the level', () => {
    pipelineForm('project', true);
    expect(screen.getByText('/x/epic.yaml')).toBeTruthy();
  });

  it('has the level switch and the buttons without locked when both levels exist', () => {
    pipelineForm('project_over_global');
    expect(screen.getByRole('radio', { name: 'Global' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

describe('the form of an action with locked', () => {
  const action = actionEntry('notify', { name: 'Notify', command: 'echo hi' });
  const mountAction = (locked?: boolean) => {
    const api = fakeApi();
    render(
      <ActionForm
        api={api}
        view={configView({})}
        action={action}
        notice={null}
        onDirty={vi.fn()}
        onReload={vi.fn(async () => undefined)}
        onSaved={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
        {...(locked === undefined ? {} : { locked })}
      />,
    );
    return api;
  };

  it('is view only: disabled fields, no level switch, no buttons, the file stays', () => {
    const api = mountAction(true);
    expect(fields().length).toBeGreaterThan(0);
    expect(fields().filter((field) => !field.disabled)).toEqual([]);
    for (const name of WRITES) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Global' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Project' })).toBeNull();
    expect(screen.getByText(action.file)).toBeTruthy();
    expect(screen.getByText('project')).toBeTruthy();
    expect(api.writeAction).not.toHaveBeenCalled();
    expect(api.deleteAction).not.toHaveBeenCalled();
  });

  it('stays editable without locked', () => {
    mountAction();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Global' })).toBeTruthy();
  });
});
