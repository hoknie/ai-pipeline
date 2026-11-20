import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { modelIdProblem } from '../../../src/feature/swarm-config/types/index.ts';
import {
  parseConfig,
  validateObserverProfile,
} from '../../../src/feature/swarm-config/services/index.ts';
import { ConfigLoadError } from '../../../src/feature/swarm-config/types/index.ts';
import { configPaths, loadConfig } from '../../../src/feature/swarm-config/services/index.ts';

function fieldErrors(text: string) {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigLoadError && error.detail.kind === 'invalid')
      return error.detail.errors;
    throw error;
  }
  throw new Error('expected invalid configuration');
}

describe('OpenCode model identifiers', () => {
  it.each(['openai/gpt-6.1-sol', 'MyProvider/team/GPT-custom'])('preserves %s', (model) => {
    expect(modelIdProblem('opencode', model)).toBeNull();
  });

  it.each(['gpt-6.1-sol', '/x', 'x/', '/', 'openai/gpt 6', ' openai/gpt', 'openai/gpt\n'])(
    'rejects %s',
    (model) => {
      expect(modelIdProblem('opencode', model)).toBe(
        `OpenCode model "${model}" must use provider/model format, for example openai/gpt-6.1-sol`,
      );
    },
  );

  it('preserves the exact value and case', () => {
    const model = 'MyProvider/team/GPT-Custom';
    expect(modelIdProblem('opencode', model)).toBeNull();
    expect(model).toBe('MyProvider/team/GPT-Custom');
  });

  it('does not constrain other runtimes or absent models', () => {
    expect(modelIdProblem('opencode', null)).toBeNull();
    expect(modelIdProblem('claude', 'sonnet')).toBeNull();
    expect(modelIdProblem('agy', 'gemini')).toBeNull();
  });

  it('validates the effective runtime and enabled naming settings', () => {
    const specialistErrors = fieldErrors(
      `swarm:\n  defaults: { runtime: opencode }\n  specialists:\n    coder:\n      name: Coder\n      model: luna-6.1\n`,
    );
    expect(specialistErrors).toContainEqual({
      path: 'swarm.specialists.coder.model',
      message: expect.stringContaining('OpenCode model "luna-6.1" must use provider/model format'),
    });
    const reverseOrderErrors = fieldErrors(
      `swarm:\n  naming:\n    model: haiku\n    enabled: true\n    runtime: opencode\n`,
    );
    expect(reverseOrderErrors).toContainEqual({
      path: 'swarm.naming.model',
      message:
        'OpenCode model "haiku" must use provider/model format, for example openai/gpt-6.1-sol',
    });
    expect(() =>
      parseConfig(`swarm:\n  naming: { model: haiku, runtime: opencode, enabled: false }\n`),
    ).not.toThrow();
  });

  it('validates a specialist after resolving runtime regardless of key order', () => {
    for (const specialist of [
      `name: Coder\n      runtime: opencode\n      model: short-id`,
      `model: short-id\n      name: Coder\n      runtime: opencode`,
    ]) {
      const errors = fieldErrors(`swarm:\n  specialists:\n    coder:\n      ${specialist}\n`);
      expect(errors.filter((error) => error.path === 'swarm.specialists.coder.model')).toEqual([
        {
          path: 'swarm.specialists.coder.model',
          message:
            'OpenCode model "short-id" must use provider/model format, for example openai/gpt-6.1-sol',
        },
      ]);
    }
  });

  it('does not duplicate model errors for non-string or empty values', () => {
    const errors = fieldErrors(
      `swarm:\n  specialists:\n    coder: { name: Coder, runtime: opencode, model: 3 }\n`,
    );
    expect(errors.filter((error) => error.path === 'swarm.specialists.coder.model')).toHaveLength(
      1,
    );
    expect(errors[0]?.message).toContain('must be a string');
  });

  it('uses the shared specialist validator for observer profiles', () => {
    const { errors } = validateObserverProfile({ runtime: 'opencode', model: 'gpt-short' });
    expect(errors).toContainEqual({
      path: 'specialist.model',
      message: expect.stringContaining('OpenCode model "gpt-short" must use provider/model format'),
    });
  });

  it('reports the source file for invalid specialist model IDs', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-model-source-'));
    const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
    const file = join(paths.global.directory, 'specialists', 'reviewer.yaml');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'name: Reviewer\nruntime: opencode\nmodel: short\n');
    try {
      loadConfig(paths);
    } catch (error) {
      if (!(error instanceof ConfigLoadError) || error.detail.kind !== 'invalid') throw error;
      expect(error.detail.errors).toContainEqual({
        file,
        path: 'swarm.specialists.reviewer.model',
        message: expect.stringContaining('OpenCode model "short"'),
      });
      return;
    }
    throw new Error('expected invalid model');
  });

  it('validates naming after global and project settings are merged', () => {
    const root = mkdtempSync(join(tmpdir(), 'aip-model-naming-'));
    const paths = configPaths(join(root, 'repo'), join(root, 'xdg'), undefined);
    mkdirSync(paths.global.directory, { recursive: true });
    mkdirSync(paths.project.directory, { recursive: true });
    writeFileSync(join(paths.global.directory, 'settings.yaml'), 'naming: { runtime: opencode }\n');
    writeFileSync(
      join(paths.project.directory, 'settings.yaml'),
      'naming: { enabled: true, model: haiku }\n',
    );
    expect(() => loadConfig(paths)).toThrow(/swarm\.naming\.model/);
  });

  it.each([
    ['3', 'must be a string'],
    ['null', 'must be a string'],
    ['""', 'must not be empty'],
    ['"   "', 'must not be empty'],
  ])('does not add a model-format error after a naming model read error (%s)', (value, message) => {
    const errors = fieldErrors(
      `swarm:\n  naming: { enabled: true, runtime: opencode, model: ${value} }\n`,
    );
    expect(errors.filter((error) => error.path === 'swarm.naming.model')).toEqual([
      { path: 'swarm.naming.model', message },
    ]);
  });
});
