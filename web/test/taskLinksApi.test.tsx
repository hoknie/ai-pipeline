import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueApi } from '../src/shared/api/queueApi.ts';

describe('task links API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a link and its removal to the matching routes', async () => {
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
