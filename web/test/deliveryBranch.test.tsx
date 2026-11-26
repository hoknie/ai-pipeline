// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { App } from '../src/app/App.tsx';
import { RunSummary } from '../src/features/runs/header/RunSummary.tsx';
import type { Api } from '../src/shared/api/api.ts';
import { DeliveryFields } from '../src/features/queue/form/DeliveryFields.tsx';
import { useBranchValidation } from '../src/features/queue/form/branch/useBranchValidation.ts';
import { draftOf, emptyDraft, fieldsOf } from '../src/features/queue/draft.ts';
import { projectsFields } from '../src/features/queue/form/sharedTag.ts';
import { act, choose, cleanup, fireEvent, render, renderHook, screen, waitFor } from './render.tsx';
import { fakeApi, openFake, queueOf, runView } from './fixtures.ts';

afterEach(cleanup);

describe('delivery branch of a task', () => {
  it('survives an edit draft and reaches the multi-project request', () => {
    const branch = { name: 'feature/x', strategy: 'existing' as const };
    const draft = draftOf({
      pipeline: 'feature',
      task: 'x',
      groups: null,
      title: null,
      autoDeliver: true,
      deliveryMode: 'commit',
      deliveryBranch: branch,
    });
    const fields = fieldsOf(draft);
    expect(fields.deliveryBranch).toEqual(branch);
    expect(
      projectsFields(fields, { projects: ['/a', '/b'], notes: {}, tag: '', chain: false })
        .deliveryBranch,
    ).toEqual(branch);
    expect(fieldsOf({ ...draft, deliveryBranch: null })).not.toHaveProperty('deliveryBranch');
  });

  it('checks each project and ignores an outdated validation response', async () => {
    const pending: Record<string, (names: string[]) => void> = {};
    const calls: string[] = [];
    const api = {
      forRepository: (project: string) => ({
        branches: () => {
          calls.push(project);
          return new Promise<string[]>((resolve) => {
            pending[project] = resolve;
          });
        },
      }),
    } as unknown as Api;
    const branch = { name: 'feature/x', strategy: 'existing' as const };
    const { result, rerender } = renderHook(
      ({ projects }) => useBranchValidation(api, projects, branch),
      { initialProps: { projects: ['/a', '/b'] } },
    );
    expect(result.current).toBe('pending');
    expect(calls).toEqual(['/a', '/b']);
    const oldA = pending['/a']!;
    const oldB = pending['/b']!;
    rerender({ projects: ['/c'] });
    await act(async () => {
      oldA(['feature/x']);
      oldB(['feature/x']);
    });
    expect(result.current).toBe('pending');
    await act(async () => pending['/c']!([]));
    await waitFor(() => expect(result.current).toBe('invalid'));
  });

  it('rejects @ as a new target before submission', async () => {
    const queueAdd = vi.fn();
    const api = fakeApi({
      queue: vi.fn(async () => queueOf({ deliveryMode: 'commit' })),
      branches: vi.fn(async () => []),
      queueAdd,
    });
    render(<App api={api} openStream={openFake} />);
    const open = await screen.findByRole('button', { name: 'New task' });
    await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false));
    fireEvent.click(open);
    fireEvent.change(await screen.findByLabelText('Task text'), { target: { value: 'hello' } });
    fireEvent.change(await screen.findByLabelText('Target branch'), { target: { value: '@' } });
    expect(
      screen
        .getByRole('button', { name: 'Create this branch on delivery' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('clears the target when auto delivery is disabled', () => {
    function Form() {
      const [draft, setDraft] = useState({
        ...emptyDraft('feature'),
        autoDeliver: true,
        deliveryMode: 'commit' as const,
        deliveryBranch: { name: 'feature/x', strategy: 'existing' as const },
      });
      return (
        <DeliveryFields
          state={{
            idPrefix: 'x',
            effective: draft,
            change: (patch) => setDraft((old) => ({ ...old, ...patch }) as typeof old),
            locked: false,
          }}
          autoDeliverDefault={true}
          deliveryModeDefault="commit"
        />
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByLabelText('Target branch')).toBeNull();
    expect(screen.getByText('The target branch was cleared.')).toBeTruthy();
  });

  it('does not display stale search answers after changing the query', async () => {
    const pending: Record<string, (names: string[]) => void> = {};
    const api = {
      forRepository: () => ({
        branches: (query: string) =>
          new Promise<string[]>((resolve) => {
            pending[query] = resolve;
          }),
      }),
    } as unknown as Api;
    function Form() {
      const [draft, setDraft] = useState({
        ...emptyDraft('feature'),
        autoDeliver: true,
        deliveryMode: 'commit' as const,
      });
      return (
        <DeliveryFields
          state={{
            idPrefix: 'x',
            effective: draft,
            change: (patch) => setDraft((old) => ({ ...old, ...patch }) as typeof old),
            locked: false,
          }}
          autoDeliverDefault={true}
          deliveryModeDefault="commit"
          api={api}
          repository="/a"
        />
      );
    }
    render(<Form />);
    const input = screen.getByLabelText('Target branch');
    fireEvent.change(input, { target: { value: 'first' } });
    await waitFor(() => expect(pending.first).toBeDefined());
    fireEvent.change(input, { target: { value: 'second' } });
    await waitFor(() => expect(pending.second).toBeDefined());
    await act(async () => pending.second!(['second-branch']));
    expect(screen.getByRole('button', { name: 'second-branch' })).toBeTruthy();
    await act(async () => pending.first!(['first-branch']));
    expect(screen.queryByRole('button', { name: 'first-branch' })).toBeNull();
  });

  it('sends a selected target and keeps the draft when submission fails', async () => {
    const queueAdd = vi.fn(async () => {
      throw new Error('delivery refused');
    });
    const api = fakeApi({
      queue: vi.fn(async () => queueOf({ deliveryMode: 'commit' })),
      branches: vi.fn(async () => ['feature/x']),
      queueAdd,
    });
    render(<App api={api} openStream={openFake} />);
    const open = await screen.findByRole('button', { name: 'New task' });
    await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false));
    fireEvent.click(open);
    fireEvent.change(await screen.findByLabelText('Task text'), { target: { value: 'hello' } });
    fireEvent.change(await screen.findByLabelText('Target branch'), {
      target: { value: 'feature' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'feature/x' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryBranch: { name: 'feature/x', strategy: 'existing' } }),
      ),
    );
    expect(await screen.findByText('delivery refused')).toBeTruthy();
    expect((screen.getByLabelText('Target branch') as HTMLInputElement).value).toBe('feature/x');
  });

  it('sends an explicitly created target after checking it is free', async () => {
    const queueAdd = vi.fn(async () => {
      throw new Error('stop');
    });
    const branches = vi.fn(async () => []);
    const api = fakeApi({
      queue: vi.fn(async () => queueOf({ deliveryMode: 'commit' })),
      branches,
      queueAdd,
    });
    render(<App api={api} openStream={openFake} />);
    const open = await screen.findByRole('button', { name: 'New task' });
    await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false));
    fireEvent.click(open);
    fireEvent.change(await screen.findByLabelText('Task text'), { target: { value: 'hello' } });
    fireEvent.change(await screen.findByLabelText('Target branch'), {
      target: { value: 'feature/new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create this branch on delivery' }));
    await waitFor(() => expect(branches).toHaveBeenCalledWith('feature/new', true));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(queueAdd).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryBranch: { name: 'feature/new', strategy: 'create' } }),
      ),
    );
  });

  it('clears the target when changing the delivery mode', () => {
    function Form() {
      const [draft, setDraft] = useState({
        ...emptyDraft('feature'),
        autoDeliver: true,
        deliveryMode: 'commit' as const,
        deliveryBranch: { name: 'feature/x', strategy: 'existing' as const },
      });
      return (
        <DeliveryFields
          state={{
            idPrefix: 'x',
            effective: draft,
            change: (patch) => setDraft((old) => ({ ...old, ...patch }) as typeof old),
            locked: false,
          }}
          autoDeliverDefault={true}
          deliveryModeDefault="commit"
        />
      );
    }
    render(<Form />);
    choose(screen.getByRole('combobox', { name: 'Delivery mode' }), 'In the working tree');
    expect(screen.queryByLabelText('Target branch')).toBeNull();
    expect(screen.getByText('The target branch was cleared.')).toBeTruthy();
    choose(screen.getByRole('combobox', { name: 'Delivery mode' }), 'Commit');
    expect((screen.getByLabelText('Target branch') as HTMLInputElement).value).toBe('');
  });

  it('shows the target name and strategy in the run summary', () => {
    const run = runView({ deliveryBranch: { name: 'feature/new', strategy: 'create' } });
    render(<RunSummary run={run} now={run.createdAt} />);
    expect(screen.getByText('Target branch')).toBeTruthy();
    expect(screen.getByText('feature/new (create)')).toBeTruthy();
  });
});
