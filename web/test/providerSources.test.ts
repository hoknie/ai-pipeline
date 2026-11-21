import { describe, expect, it } from 'vitest';

import {
  overrideValue,
  sharedOnlyIn,
  sourceOf,
  writableSourceOf,
} from '../src/features/providers/page/sources.ts';
import type { EditorProvider } from '../src/shared/api/types.ts';

const source = (level: string) => ({
  file: `/${level}/p.yaml`,
  revision: `${level}-r`,
  raw: { name: level },
});

function provider(level: EditorProvider['level']): EditorProvider {
  const both = level === 'project_over_global';
  return {
    slug: 'p',
    level,
    file: '/f',
    revision: null,
    raw: {},
    sources: {
      ...(level === 'global' || both ? { global: source('global') } : {}),
      ...(level === 'project' || both ? { project: source('project') } : {}),
    },
    effective: null,
  } as EditorProvider;
}

describe('the file a write may change', () => {
  it('is the project file in the project scope, and none for a shared-only provider', () => {
    expect(writableSourceOf(provider('project'), 'project')?.level).toBe('project');
    expect(writableSourceOf(provider('project_over_global'), 'project')?.level).toBe('project');
    expect(writableSourceOf(provider('global'), 'project')).toBeNull();
    expect(writableSourceOf(undefined, 'project')).toBeNull();
  });

  it('is the shared file in the shared scope', () => {
    expect(writableSourceOf(provider('global'), 'global')?.level).toBe('global');
    expect(writableSourceOf(provider('project_over_global'), 'global')?.level).toBe('global');
    expect(writableSourceOf(provider('project'), 'global')).toBeNull();
  });

  it('is not what the page shows: the shared file is still read in the project scope', () => {
    expect(sourceOf(provider('global'), 'project')?.level).toBe('global');
    expect(sharedOnlyIn(provider('global'), 'project')).toBe(true);
    expect(sharedOnlyIn(provider('project_over_global'), 'project')).toBe(false);
    expect(sharedOnlyIn(provider('global'), 'global')).toBe(false);
    expect(sharedOnlyIn(undefined, 'project')).toBe(false);
  });
});

describe('the project copy of a shared provider', () => {
  it('drops command and args of every access and says so', () => {
    const raw = {
      name: 'Z.ai',
      access: [
        {
          kind: 'cli',
          runtime: 'opencode',
          command: 'opencode',
          args: ['run'],
          model_prefix: 'z/',
        },
        { kind: 'cli', runtime: 'claude' },
      ],
    };
    expect(overrideValue(raw)).toEqual({
      raw: {
        name: 'Z.ai',
        access: [
          { kind: 'cli', runtime: 'opencode', model_prefix: 'z/' },
          { kind: 'cli', runtime: 'claude' },
        ],
      },
      stripped: true,
    });
    // the file it was made from is not touched
    expect((raw.access[0] as Record<string, unknown>).command).toBe('opencode');
  });

  it('is the same file when there is nothing to drop', () => {
    const raw = { name: 'Plain', access: [{ kind: 'cli', runtime: 'claude' }] };
    expect(overrideValue(raw)).toEqual({ raw, stripped: false });
    expect(overrideValue({ name: 'No access' })).toEqual({
      raw: { name: 'No access' },
      stripped: false,
    });
  });
});
