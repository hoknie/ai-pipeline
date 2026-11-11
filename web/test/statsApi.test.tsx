import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpApi } from '../src/shared/api/api.ts';

import { statsReportView } from './fixtures.ts';

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => Response.json(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the statistics API of the panel', () => {
  it('asks the report with the period and the project', async () => {
    const fetchMock = stub(statsReportView());
    const report = await httpApi.statsReport({ since: 10, repository: '/work/app' });
    expect(report.totals.tasks).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/stats?since=10&repository=%2Fwork%2Fapp');
  });

  it('asks the whole report without a query', async () => {
    const fetchMock = stub(statsReportView());
    await httpApi.statsReport();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/stats');
  });

  it('clears a project with DELETE', async () => {
    const fetchMock = stub({ removed: 4 });
    await expect(httpApi.statsClear('/work/lib')).resolves.toEqual({ removed: 4 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/stats?repository=%2Fwork%2Flib');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
  });
});
