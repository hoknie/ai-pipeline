import { describe, expect, it } from 'vitest';

import { requestSchema } from '../../src/presentation/ipc/contract/index.ts';

describe('delivery branch requests', () => {
  const branch = { name: 'feature/new', strategy: 'create' };
  const cases = [
    { method: 'run', params: { repository: '/repo', pipeline: 'feature', task: 'work' } },
    { method: 'queue_add', params: { repository: '/repo', pipeline: 'feature', task: 'work' } },
    {
      method: 'queue_add_projects',
      params: { repositories: ['/a', '/b'], pipeline: 'feature', task: 'work' },
    },
    { method: 'worker_queue_add', params: { token: 'token', pipeline: 'feature', task: 'work' } },
    { method: 'queue_edit', params: { repository: '/repo', item: 'q1' } },
    { method: 'worker_queue_edit', params: { token: 'token', item: 'q1' } },
  ];

  it.each(cases)('preserves a pair in $method', ({ method, params }) => {
    const result = requestSchema.parse({ method, params: { ...params, deliveryBranch: branch } });
    expect(result.params).toMatchObject({ deliveryBranch: branch });
  });

  it.each(cases.slice(0, 4))('accepts old $method requests', (request) => {
    expect(requestSchema.safeParse(request).success).toBe(true);
  });

  it.each(cases.slice(4))('allows reset in $method', ({ method, params }) => {
    expect(
      requestSchema.parse({ method, params: { ...params, deliveryBranch: null } }).params,
    ).toMatchObject({ deliveryBranch: null });
  });

  it.each([
    { name: 'feature/new' },
    { name: 'bad..name', strategy: 'existing' },
    { ...branch, extra: true },
    { ...branch, strategy: 'other' },
  ])('rejects malformed target %o', (deliveryBranch) => {
    const result = requestSchema.safeParse({
      method: 'run',
      params: { ...cases[0]!.params, deliveryBranch },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.path.includes('deliveryBranch'))).toBe(true);
  });

  it.each(cases)('rejects incomplete pairs and foreign fields in $method', ({ method, params }) => {
    for (const deliveryBranch of [
      { name: 'feature/new' },
      { strategy: 'existing' },
      { ...branch, extra: true },
    ]) {
      const result = requestSchema.safeParse({ method, params: { ...params, deliveryBranch } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('deliveryBranch'))).toBe(
          true,
        );
      }
    }
  });

  it.each(cases.slice(0, 4))('rejects null in creation request $method', ({ method, params }) => {
    expect(
      requestSchema.safeParse({ method, params: { ...params, deliveryBranch: null } }).success,
    ).toBe(false);
  });
});
