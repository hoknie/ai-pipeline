import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appError, rejected } from '../../../src/platform/errors/index.ts';
import { refusal } from '../../../src/feature/integrations/types/index.ts';
import {
  MAX_REQUEST_BYTES,
  parseRequest,
  requestSchema,
} from '../../../src/presentation/ipc/contract/index.ts';
import { handle } from '../../../src/presentation/ipc/handlers/index.ts';
import type { IpcContext } from '../../../src/presentation/ipc/handlers/types.ts';
import { SENTINEL } from '../../feature/integrations/helpers.ts';

const parse = (method: string, params: unknown) =>
  parseRequest(JSON.stringify({ id: 7, method, params }));

describe('integration requests', () => {
  it('accepts the methods with valid parameters', () => {
    for (const [method, params] of [
      ['integration_types', {}],
      ['integration_list', {}],
      ['integration_list', { repository: 'shop' }],
      ['integration_add', { kind: 'example', name: 'main', global: true, params: { a: 'b' } }],
      ['integration_add', { kind: 'example', name: 'main', repository: '/repo' }],
      ['integration_remove', { id: 'c1' }],
      ['integration_enable', { id: 'c1' }],
      ['integration_disable', { id: 'c1' }],
      ['integration_check', { id: 'c1' }],
      ['integration_skills', { id: 'c1', query: 'go' }],
      ['integration_skills', { repository: '/repo' }],
      ['integration_secret_set', { id: 'c1', slot: 'token', value: 'v' }],
      ['integration_secret_remove', { id: 'c1', slot: 'token' }],
    ] as const) {
      expect(parse(method, params)).toMatchObject({ request: { method } });
    }
  });

  it('refuses a slot that is not a name, an empty or oversized value and extra shapes', () => {
    for (const params of [
      { id: 'c1', slot: 'Bad Slot', value: 'v' },
      { id: 'c1', slot: 'token', value: '' },
      { id: 'c1', slot: 'token', value: 'x'.repeat(16 * 1024 + 1) },
      { id: 'c1', slot: 'token' },
    ]) {
      expect(parse('integration_secret_set', params)).toMatchObject({
        id: 7,
        code: 'invalid_params',
      });
    }
  });

  it('has no method that reads a secret back', () => {
    const methods = requestSchema.options.map((option) => option.shape.method.value);
    expect(methods.filter((method) => method.startsWith('integration_')).sort()).toEqual([
      'integration_add',
      'integration_check',
      'integration_disable',
      'integration_edit',
      'integration_enable',
      'integration_list',
      'integration_remove',
      'integration_secret_remove',
      'integration_secret_set',
      'integration_skills',
      'integration_types',
    ]);
  });
});

describe('fixed errors', () => {
  const broken: [string, string][] = [
    ['invalid JSON', `{"id":1,"value":"${SENTINEL}"`],
    ['no method', JSON.stringify({ id: 1, params: { value: SENTINEL } })],
    ['method of another type', JSON.stringify({ id: 1, method: { SENTINEL }, params: {} })],
    ['unknown method', JSON.stringify({ id: 1, method: SENTINEL, params: {} })],
    ['not an object', JSON.stringify([SENTINEL])],
    [
      'wrong params of a secret method',
      JSON.stringify({ id: 1, method: 'integration_secret_set', params: { value: 5, SENTINEL } }),
    ],
    [
      'wrong params of an ordinary method',
      JSON.stringify({ id: 1, method: 'tags', params: { repository: [SENTINEL] } }),
    ],
  ];

  it.each(broken)('says nothing of the input: %s', (_name, line) => {
    const parsed = parseRequest(line);
    expect('error' in parsed).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain(SENTINEL);
    expect(JSON.stringify(parsed)).not.toContain('Invalid');
    expect(Object.keys(parsed).sort()).toEqual(['code', 'error', 'id']);
  });

  it('refuses a line above the limit without parsing it', () => {
    const line = `{"id":1,"method":"ping","params":{"x":"${'x'.repeat(MAX_REQUEST_BYTES)}"}}`;
    expect(parseRequest(line)).toEqual({
      id: -1,
      error: 'request is too large',
      code: 'request_too_large',
    });
  });
});

describe('integration handlers', () => {
  const context = (thrown: unknown): IpcContext =>
    ({
      actor: { kind: 'local' },
      services: {
        integrations: {
          connections: {
            types: () => {
              throw thrown;
            },
            list: () => Promise.reject(thrown),
          },
        },
      },
    }) as unknown as IpcContext;

  it('replaces any exception by a fixed refusal and keeps the refusals of the integrations', async () => {
    const hostile = Object.assign(new Error(`boom ${SENTINEL}`), { cause: SENTINEL });
    for (const thrown of [
      hostile,
      rejected(`path ${SENTINEL}`),
      appError('internal', 'x.y', SENTINEL),
    ]) {
      const request = { method: 'integration_list', params: {} } as const;
      const error = await handle(request, context(thrown)).catch((caught: Error) => caught);
      expect((error as Error).message).toBe('integration request failed');
      expect(JSON.stringify(error)).not.toContain(SENTINEL);
    }
    const kept = await handle(
      { method: 'integration_types', params: {} },
      context(refusal('not_found')),
    ).catch((caught: Error) => caught);
    expect((kept as Error).message).toBe('connection not found');
  });
});

describe('where the methods are not offered', () => {
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? sources(path) : [path];
    });
  }

  it('has no MCP tool and no panel route that creates connections or touches secrets', () => {
    const root = join(import.meta.dirname, '..', '..', '..', 'src', 'presentation');
    const own = join('web', 'routes', 'integrations', 'integrations.ts');
    for (const place of ['mcp', 'web']) {
      for (const file of sources(join(root, place))) {
        const text = readFileSync(file, 'utf8');
        if (file.endsWith(own)) {
          // the panel reads connections and edits their non-secret parameters, nothing more
          expect(text, file).not.toMatch(
            /integration_(add|remove|enable|disable|secret_set|secret_remove)/,
          );
        } else {
          expect(text, file).not.toMatch(/integration_/);
        }
      }
    }
  });
});
