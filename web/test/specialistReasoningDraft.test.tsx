// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { draftOf, fieldOf, sameDraft, valueOf } from '../src/features/specialists/form/draft.ts';

describe('model options in a specialist draft', () => {
  const raw = {
    name: 'Coder',
    runtime: 'opencode',
    variant: 'deep',
    reasoning_effort: 'high',
    queue: true,
  };

  it('round-trips both fields, preserves unrelated fields and trims entered text', () => {
    const draft = draftOf(raw);
    draft.variant = ' company-deep ';
    draft.reasoning_effort = ' xhigh ';
    expect(valueOf(draft, raw)).toEqual({
      ...raw,
      variant: 'company-deep',
      reasoning_effort: 'xhigh',
    });
    expect(draftOf(valueOf(draft, raw))).toMatchObject({
      variant: 'company-deep',
      reasoning_effort: 'xhigh',
    });
  });

  it('clears keys instead of keeping their original values or inserting defaults', () => {
    const draft = draftOf(raw);
    draft.variant = '';
    draft.reasoning_effort = '';
    expect(valueOf(draft, raw)).toEqual({ name: 'Coder', runtime: 'opencode', queue: true });
  });

  it.each(['variant', 'reasoning_effort'] as const)(
    'tracks edits and associates errors with %s',
    (field) => {
      const before = draftOf(raw);
      const after = { ...before, [field]: 'changed' };
      expect(sameDraft(before, after)).toBe(false);
      expect(sameDraft(before, draftOf(raw))).toBe(true);
      expect(fieldOf(`swarm.specialists.coder.${field}`, 'swarm.specialists.coder.')).toBe(field);
      expect(fieldOf(`specialist.${field}`, 'specialist.')).toBe(field);
    },
  );

  it('loads the selected level without carrying model options from another level', () => {
    const shared = draftOf(raw);
    const project = draftOf({ name: 'Project', runtime: 'opencode', reasoning_effort: 'xhigh' });
    expect(shared.variant).toBe('deep');
    expect(project.variant).toBe('');
    expect(project.reasoning_effort).toBe('xhigh');
    expect(valueOf(project, {})).not.toHaveProperty('variant');
  });
});
