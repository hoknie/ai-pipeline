import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueApi } from '../src/shared/api/queueApi.ts';

describe('API связей задач', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('отправляет связь и её снятие на соответствующие маршруты', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetch);
    const api = queueApi((path) => `${path}?repository=repo`);
    await api.taskLink('one', 'parent', 'two');
    await api.taskUnlink('one', 'parent', 'two');
    for (const [index, action] of ['link', 'unlink'].entries()) {
      expect(fetch).toHaveBeenNthCalledWith(index + 1, `/api/tasks/${action}?repository=repo`, {
        credentials: 'same-origin',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'one', kind: 'parent', target: 'two' }),
      });
    }
  });
});
