import { describe, expect, it } from 'vitest';

import { buildInput } from '../../../src/feature/runs/types/index.ts';
import { group, run } from './helpers.ts';

const FILES = [{ id: 'a1', fileName: 'shot.png', size: 2048, mediaType: 'image/png' }];

describe('attachments in the input of a step', () => {
  it('copies name, size and type, without the id, when the run has attachments', () => {
    const state = run(1);
    state.run.attachments = FILES;
    const input = buildInput(state.run, group(state), group(state).pending!);
    expect(input.attachments).toEqual([
      { fileName: 'shot.png', size: 2048, mediaType: 'image/png' },
    ]);
  });

  it('leaves the input as it was without attachments', () => {
    const state = run(1);
    const input = buildInput(state.run, group(state), group(state).pending!);
    expect('attachments' in input).toBe(false);
  });
});
