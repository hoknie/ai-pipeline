import { describe, expect, it } from 'vitest';

import {
  draftOf,
  draftValid,
  emptyDraft,
  fieldsOf,
  retarget,
} from '../src/features/queue/draft.ts';

describe('variant of the queue draft', () => {
  it('starts as default and is sent only when it is not the default, always on edit', () => {
    const draft = emptyDraft('feature');
    expect(draft.variant).toBe('default');
    expect(fieldsOf({ ...draft, task: 'x' })).not.toHaveProperty('variant');
    expect(fieldsOf({ ...draft, task: 'x', variant: 'light' }).variant).toBe('light');
    expect(fieldsOf({ ...draft, task: 'x' }, () => undefined, true).variant).toBe('default');
  });

  it('is read from an item and dropped when the new repository has no such variant', () => {
    const draft = draftOf({
      pipeline: 'feature',
      variant: 'light',
      task: 'x',
      groups: null,
      title: null,
      autoDeliver: null,
    });
    expect(draft.variant).toBe('light');
    const keep = retarget(
      draft,
      ['feature'],
      () => [],
      () => ['default', 'light'],
    );
    expect(keep.variant).toBe('light');
    const drop = retarget(
      draft,
      ['feature'],
      () => [],
      () => ['default'],
    );
    expect(drop.variant).toBe('default');
  });
});

describe('queue draft task/title normalization', () => {
  it.each([
    ['', '', false],
    ['Title', '', true],
    ['', 'Description', true],
    ['Title', 'Description', true],
  ])('validates task title=%j task=%j as %j', (title, task, valid) => {
    const draft = { ...emptyDraft('feature'), title, task };
    expect(draftValid(draft)).toBe(valid);
    if (valid) {
      const fields = fieldsOf(draft);
      expect(fields.task).toBe(task || title);
      if (title) expect(fields.title).toBe(title);
      else expect(fields).not.toHaveProperty('title');
      expect(fields).not.toHaveProperty('groups');
    }
  });

  it('sends mixed groups in order: title only, description only and both fields', () => {
    const draft = {
      ...emptyDraft('feature'),
      mode: 'groups' as const,
      task: 'hidden task mode value',
      groups: [
        { title: 'Only title', task: '' },
        { title: '', task: 'Fix login\nCheck the error' },
        { title: 'Both', task: 'Both body' },
      ],
    };
    expect(draftValid(draft)).toBe(true);
    expect(fieldsOf(draft)).toEqual({
      pipeline: 'feature',
      groups: [
        { title: 'Only title', task: 'Only title' },
        { title: 'Fix login', task: 'Fix login\nCheck the error' },
        { title: 'Both', task: 'Both body' },
      ],
    });
  });

  it('rejects a blank group among filled ones', () => {
    const draft = {
      ...emptyDraft('feature'),
      mode: 'groups' as const,
      groups: [
        { title: 'Only title', task: '' },
        { title: '', task: 'Only description' },
        { title: '  ', task: '\n' },
      ],
    };
    expect(draftValid(draft)).toBe(false);
  });

  it.each([
    ['T'.repeat(60), true],
    ['T'.repeat(61), false],
    ['😀'.repeat(60), true],
    ['😀'.repeat(61), false],
  ])('limits the shared title to 60 Unicode code points (%j)', (title, valid) => {
    expect(draftValid({ ...emptyDraft('feature'), title, task: 'body' })).toBe(valid);
    expect(
      draftValid({
        ...emptyDraft('feature'),
        title,
        mode: 'groups',
        groups: [{ title: 'Group', task: '' }],
      }),
    ).toBe(valid);
  });

  it('requires every group to have either field and derives a Unicode-safe title', () => {
    const draft = {
      ...emptyDraft('feature'),
      mode: 'groups' as const,
      title: 'Overall',
      groups: [
        { title: 'Named', task: '' },
        { title: '', task: `\n  ${'😀'.repeat(62)}\r\n- body ` },
      ],
    };
    expect(draftValid(draft)).toBe(true);
    expect(fieldsOf(draft)).toMatchObject({
      groups: [
        { title: 'Named', task: 'Named' },
        { title: '😀'.repeat(60), task: `${'😀'.repeat(62)}\r\n- body` },
      ],
    });
    expect(draft.groups[0]?.task).toBe('');
  });

  it.each(['\n', '  ', '\r\n'])(
    'rejects empty active fields and missing pipelines (%j)',
    (blank) => {
      const validTask = { ...emptyDraft('feature'), task: 'valid task' };
      expect(draftValid(validTask)).toBe(true);
      expect(draftValid({ ...validTask, pipeline: '' })).toBe(false);
      const emptyTask = { ...emptyDraft('feature'), title: blank, task: blank };
      expect(draftValid(emptyTask)).toBe(false);
      expect(
        draftValid({
          ...emptyTask,
          mode: 'groups',
          title: 'overall title does not fill a group',
          groups: [{ title: blank, task: blank }],
        }),
      ).toBe(false);
      expect(draftValid({ ...emptyTask, mode: 'groups', groups: [] })).toBe(false);
      expect(
        draftValid({
          ...emptyDraft('feature'),
          task: 'hidden',
          mode: 'groups',
          groups: [{ title: '', task: '' }],
        }),
      ).toBe(false);
    },
  );

  it('keeps long explicit group titles and serializes each line separator without mutation', () => {
    const explicit = 'T'.repeat(80);
    for (const separator of ['\n', '\r\n', '\r']) {
      const draft = {
        ...emptyDraft('feature'),
        mode: 'groups' as const,
        groups: [{ title: explicit, task: ` First${separator}second ` }],
      };
      const before = structuredClone(draft);
      expect(fieldsOf(draft)).toMatchObject({
        groups: [{ title: explicit, task: `First${separator}second` }],
      });
      expect(draft).toEqual(before);
    }
  });

  it('derives titles from the exact first Markdown line with LF, CRLF and CR without mutation', () => {
    for (const separator of ['\n', '\r\n', '\r']) {
      const text = `  ## First${separator}- second  `;
      const draft = {
        ...emptyDraft('feature'),
        title: '',
        task: 'hidden task mode value',
        mode: 'groups' as const,
        groups: [{ title: '', task: text }],
      };
      const before = structuredClone(draft);
      expect(fieldsOf(draft)).toEqual({
        pipeline: 'feature',
        groups: [{ title: '## First', task: `## First${separator}- second` }],
      });
      expect(draft).toEqual(before);
    }
  });

  it.each([60, 61])('truncates a derived title at %i Unicode code points', (length) => {
    const draft = {
      ...emptyDraft('feature'),
      mode: 'groups' as const,
      groups: [{ title: '', task: `${'😀'.repeat(length)}\nbody` }],
    };
    expect(fieldsOf(draft).groups?.[0]?.title).toBe('😀'.repeat(Math.min(length, 60)));
  });
});
