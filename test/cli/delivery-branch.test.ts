import { describe, expect, it } from 'vitest';

import { aip, runOf, sandbox } from './sandbox.ts';

describe('delivery branch CLI', () => {
  it('rejects an incomplete pair and conflicting reset flags with actionable errors', async () => {
    const box = sandbox();
    const incomplete = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'work',
      '--delivery-branch',
      'feature/x',
    );
    expect(incomplete.code).not.toBe(0);
    expect(incomplete.stderr + incomplete.stdout).toContain(
      '--delivery-branch and --delivery-branch-strategy must be passed together',
    );
    const invalid = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'work',
      '--delivery-branch',
      'feature/x',
      '--delivery-branch-strategy',
      'bad',
    );
    expect(invalid.stderr + invalid.stdout).toContain(
      '--delivery-branch-strategy must be existing or create',
    );
    const clash = await aip(
      box,
      'queue',
      'edit',
      'q1',
      '--clear-delivery-branch',
      '--delivery-branch',
      'feature/x',
    );
    expect(clash.stderr + clash.stdout).toContain('--clear-delivery-branch cannot be combined');
  });

  it('adds, displays and clears a target branch', async () => {
    const box = sandbox();
    const added = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'work',
      '--auto-deliver',
      '--delivery-mode',
      'commit',
      '--delivery-branch',
      'feature/new',
      '--delivery-branch-strategy',
      'create',
      '--json',
    );
    expect(added.code).toBe(0);
    const view = JSON.parse(added.stdout) as { items: { id: string; deliveryBranch: unknown }[] };
    expect(view.items[0]!.deliveryBranch).toEqual({ name: 'feature/new', strategy: 'create' });
    expect((await aip(box, 'queue', 'list')).stdout).toContain(
      'delivery branch: feature/new (create)',
    );
    const edited = await aip(
      box,
      'queue',
      'edit',
      view.items[0]!.id,
      '--delivery-branch',
      'feature/other',
      '--delivery-branch-strategy',
      'create',
      '--json',
    );
    expect(edited.code).toBe(0);
    expect(JSON.parse(edited.stdout).items[0].deliveryBranch).toEqual({
      name: 'feature/other',
      strategy: 'create',
    });
    const cleared = await aip(
      box,
      'queue',
      'edit',
      view.items[0]!.id,
      '--clear-delivery-branch',
      '--json',
    );
    expect(cleared.code).toBe(0);
    expect(JSON.parse(cleared.stdout).items[0].deliveryBranch).toBeNull();
  });

  it('reports incompatible delivery settings and missing existing branches', async () => {
    const box = sandbox();
    const incompatible = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'work',
      '--no-auto-deliver',
      '--delivery-mode',
      'commit',
      '--delivery-branch',
      'feature/new',
      '--delivery-branch-strategy',
      'create',
    );
    expect(incompatible.code).not.toBe(0);
    expect(incompatible.stderr + incompatible.stdout).toContain(
      'deliveryBranch requires autoDeliver: true and deliveryMode: commit',
    );
    const missing = await aip(
      box,
      'queue',
      'add',
      'feature',
      '--task',
      'work',
      '--auto-deliver',
      '--delivery-mode',
      'commit',
      '--delivery-branch',
      'feature/missing',
      '--delivery-branch-strategy',
      'existing',
    );
    expect(missing.code).not.toBe(0);
    expect(missing.stderr + missing.stdout).toContain(
      'deliveryBranch `feature/missing` does not exist',
    );
  });

  it('passes the target through run start and shows the saved target', async () => {
    const box = sandbox();
    const started = await aip(
      box,
      'run',
      'start',
      'feature',
      '--task',
      'work',
      '--auto-deliver',
      '--delivery-mode',
      'commit',
      '--delivery-branch',
      'feature/new',
      '--delivery-branch-strategy',
      'create',
      '--json',
    );
    expect(started.code).toBe(0);
    const { runId } = runOf(started.stdout);
    const json = await aip(box, 'run', 'show', runId, '--json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout).deliveryBranch).toEqual({
      name: 'feature/new',
      strategy: 'create',
    });
    const text = await aip(box, 'run', 'show', runId);
    expect(text.stdout).toContain('Delivery branch: feature/new (create)');
  });
});
