// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App.tsx';
import { SpecialistLoadBar } from '../src/components/shell/SpecialistLoadBar.tsx';

import {
  FakeEventSource,
  fakeApi,
  openFake,
  repositoryView,
  runView,
  specialistUse,
} from './fixtures.ts';
import { act, cleanup, fireEvent, render, screen, within } from './render.tsx';

beforeAll(() => {
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
});

afterEach(() => cleanup());

const APP = '/work/app';
const LIB = '/work/lib';

const runs = () => [
  runView({
    id: 'r1',
    title: 'Первый',
    repository: APP,
    specialists: [
      specialistUse('coder', { level: 'global', max: 1, running: ['login'] }),
      specialistUse('plan', { waiting: ['spec'] }),
    ],
  }),
  runView({
    id: 'r2',
    title: 'Второй',
    repository: LIB,
    specialists: [specialistUse('coder', { level: 'global', max: 1, waiting: ['api'] })],
  }),
];

const toggle = () => screen.getByRole('button', { name: 'Specialist load' });

describe('specialist load bar', () => {
  it('is collapsed with a summary and opens to the global and project blocks', () => {
    render(<SpecialistLoadBar runs={runs()} selected={APP} onOpenGroup={vi.fn()} />);
    expect(within(toggle()).getByText('running 1 · waiting 2')).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Global' })).toBeNull();
    fireEvent.click(toggle());
    const global = screen.getByRole('region', { name: 'Global' });
    expect(within(global).getByText('busy 1 of 1 · waiting 1')).toBeTruthy();
    expect(within(global).getByText('app')).toBeTruthy();
    expect(within(global).getByText('lib')).toBeTruthy();
    const project = screen.getByRole('region', { name: 'Project' });
    expect(within(project).getByText('plan')).toBeTruthy();
    expect(within(project).queryByText('coder')).toBeNull();
    // a running and a waiting group are told apart by their status
    const row = (name: string) => screen.getByRole('button', { name }).closest('li')!;
    expect(within(row('login')).getByText(/running/i)).toBeTruthy();
    expect(within(row('api')).queryByText(/running/i)).toBeNull();
    expect(row('api').textContent).not.toBe(row('login').textContent);
  });

  it('says that every specialist is free', () => {
    render(<SpecialistLoadBar runs={[runView()]} selected={APP} onOpenGroup={vi.fn()} />);
    expect(within(toggle()).getByText('All specialists are free')).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.getByText('No specialists are busy.')).toBeTruthy();
  });

  it('opens a group from the list', () => {
    const open = vi.fn();
    render(<SpecialistLoadBar runs={runs()} selected={APP} onOpenGroup={open} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'api' }));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r2', group: 'api', repository: LIB, step: 'code' }),
    );
  });

  it('remembers whether it is open', () => {
    const view = render(<SpecialistLoadBar runs={runs()} selected={APP} onOpenGroup={vi.fn()} />);
    fireEvent.click(toggle());
    view.unmount();
    render(<SpecialistLoadBar runs={runs()} selected={APP} onOpenGroup={vi.fn()} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('specialist load bar in the panel', () => {
  function mount() {
    render(<App api={fakeApi()} openStream={openFake} />);
    act(() =>
      FakeEventSource.last?.send({
        event: 'snapshot',
        seq: 1,
        runs: runs(),
        repositories: [repositoryView(APP), repositoryView(LIB)],
      }),
    );
  }

  it('stays under the Topology and Queue tabs and follows the events', async () => {
    window.location.hash = '#topology/feature';
    mount();
    expect(await screen.findByText('running 1 · waiting 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Queue' }));
    expect(await screen.findByText('running 1 · waiting 2')).toBeTruthy();
    act(() =>
      FakeEventSource.last?.send({
        event: 'run',
        run: runView({
          id: 'r2',
          title: 'Второй',
          repository: LIB,
          specialists: [specialistUse('coder', { level: 'global', max: 1, running: ['api'] })],
        }),
      }),
    );
    expect(await screen.findByText('running 2 · waiting 1')).toBeTruthy();
  });

  it('selects the repository of the run when a group is opened', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Specialist load' }));
    fireEvent.click(screen.getByRole('button', { name: 'api' }));
    expect(window.location.hash).toBe('#runs/r2/api/code');
  });
});
