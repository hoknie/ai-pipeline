// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatsReportView } from '../src/shared/api/types.ts';
import { rememberProjects } from '../src/shared/lib/catalog/repositories.ts';
import StatsPage from '../src/features/stats/StatsPage.tsx';
import type { StatsPeriodId } from '../src/shared/lib/nav/route.ts';

import { fakeApi, repositoryView, statsReportView } from './fixtures.ts';
import { cleanup, fireEvent, render, screen, waitFor, within } from './render.tsx';

const registry = [
  repositoryView('/work/app', { color: 'blue' }),
  repositoryView('/work/lib', { color: 'green' }),
];

beforeEach(() => rememberProjects(registry));
afterEach(() => cleanup());

const stat = (mean: number, median = mean) => ({ mean, median });
const perTask = (tokens: number, agentMs: number) => ({
  tokens: stat(tokens),
  agentMs: stat(agentMs),
  wallMs: stat(agentMs),
});

function totalsOf(tokens: number, agentMs: number, tasks = 1) {
  return {
    tasks,
    attempts: tasks,
    inputTokens: Math.round(tokens * 0.7),
    outputTokens: Math.round(tokens * 0.3),
    tokens,
    agentMs,
    commandMs: 0,
    wallMs: agentMs,
  };
}

const row = (key: string, tokens: number, agentMs: number, name: string | null = null) => ({
  key,
  name,
  attempts: 2,
  inputTokens: Math.round(tokens * 0.7),
  outputTokens: Math.round(tokens * 0.3),
  tokens,
  agentMs,
  tokensPerAttempt: tokens / 2,
});

/** Two projects over two days: `app` 90 000 tokens, `lib` 10 000; 2 tasks, 1 h 30 min. */
function twoProjects(overrides: Partial<StatsReportView> = {}): StatsReportView {
  const day = (name: string, start: number, app: number, lib: number) => ({
    day: name,
    start,
    tokens: app + lib,
    agentMs: (app + lib) * 10,
    tasks: 1,
    projects: [
      { repository: '/work/app', tokens: app, agentMs: app * 10, tasks: 1 },
      ...(lib > 0
        ? [
            {
              repository: '/work/lib',
              tokens: lib,
              agentMs: lib * 10,
              tasks: 1,
            },
          ]
        : []),
    ],
    models: [
      { model: 'opus', tokens: lib, agentMs: lib * 10, attempts: 1 },
      { model: 'sonnet', tokens: app, agentMs: app * 10, attempts: 1 },
    ].filter((entry) => entry.tokens > 0),
  });
  return statsReportView({
    totals: totalsOf(100_000, 5_400_000, 2),
    perTask: perTask(50_000, 2_700_000),
    outcomes: { finished: 1, failed: 1, cancelled: 0 },
    projects: [
      {
        repository: '/work/app',
        totals: totalsOf(90_000, 4_860_000),
        perTask: perTask(90_000, 4_860_000),
      },
      {
        repository: '/work/lib',
        totals: totalsOf(10_000, 540_000),
        perTask: perTask(10_000, 540_000),
      },
    ],
    byModel: [row('sonnet', 80_000, 100), row('opus', 20_000, 50)],
    bySpecialist: [row('coder', 100_000, 150)],
    series: [day('2026-06-01', 1, 60_000, 10_000), day('2026-06-02', 2, 30_000, 0)],
    ...overrides,
  });
}

function mount(
  report: StatsReportView,
  extra: { period?: StatsPeriodId; project?: string | null } = {},
) {
  const api = fakeApi({ statsReport: vi.fn(async () => report) });
  const onFilter = vi.fn();
  render(
    <StatsPage
      api={api}
      registry={registry}
      runs={[]}
      period={extra.period ?? '30d'}
      project={extra.project ?? null}
      onFilter={onFilter}
    />,
  );
  return { api, onFilter };
}

const tile = (label: string) => {
  const found = screen.getAllByTestId('kpi-tile').find((item) => within(item).queryByText(label));
  if (!found) throw new Error(`no tile ${label}`);
  return within(found);
};

describe('tiles', () => {
  it('shows the totals, the averages and the medians of the period', async () => {
    mount(twoProjects());
    await screen.findByText('Tokens per task');
    expect(tile('Tokens').getByText('100k')).toBeTruthy();
    expect(tile('Agent work').getByText('1 h 30 min')).toBeTruthy();
    expect(tile('Tasks').getByText('2')).toBeTruthy();
    expect(tile('Tasks').getByText('finished 1 · failed 1 · cancelled 0')).toBeTruthy();
    expect(tile('Tokens per task').getByText('50k')).toBeTruthy();
    expect(tile('Tokens per task').getByText('median 50k')).toBeTruthy();
    expect(tile('Agent work per task').getByText('45 min')).toBeTruthy();
  });

  it('puts the exact number of tokens in the tip', async () => {
    mount(twoProjects());
    await screen.findByText('Tokens per task');
    expect(tile('Tokens').getByText('100k').getAttribute('title')).toBe('100,000');
  });

  it('shows no cost tile, column or metric', async () => {
    mount(twoProjects());
    await screen.findByText('Tokens per task');
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText('Cost per task')).toBeNull();
    expect(screen.queryByText(/without cost/)).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Cost' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cost' })).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe('filters', () => {
  it('asks for another period', async () => {
    const { onFilter } = mount(twoProjects());
    fireEvent.click(await screen.findByRole('radio', { name: '7 days' }));
    expect(onFilter).toHaveBeenCalledWith('7d', null);
  });

  it('shows the period and the project of the address', async () => {
    const { api } = mount(twoProjects(), { period: '90d', project: '/work/app' });
    await waitFor(() => expect(api.statsReport).toHaveBeenCalled());
    expect(screen.getByRole('radio', { name: '90 days' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Project').value).toBe('/work/app');
    expect(vi.mocked(api.statsReport).mock.calls[0]?.[0]?.repository).toBe('/work/app');
  });

  it('picks a project in the list', async () => {
    const { onFilter } = mount(twoProjects());
    await screen.findByText('Tokens per task');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '/work/lib' } });
    expect(onFilter).toHaveBeenCalledWith('30d', '/work/lib');
  });
});

describe('daily chart', () => {
  it('draws stacked area layers of the projects', async () => {
    mount(twoProjects());
    const chart = await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    expect(screen.getByTestId('area-series-/work/app')).toBeTruthy();
    expect(screen.getByTestId('area-series-/work/lib')).toBeTruthy();
    expect(screen.getByTestId('slot-2026-06-01')).toBeTruthy();
    expect(screen.getByTestId('slot-2026-06-02')).toBeTruthy();
    fireEvent.focus(chart);
    const tip = within(screen.getByTestId('chart-tooltip'));
    expect(tip.getByText('app')).toBeTruthy();
    expect(tip.getByText('lib')).toBeTruthy();
    expect(tip.getByText('70k')).toBeTruthy();
  });

  it('folds more than eight projects into «Other», the table keeps all', async () => {
    const make = (index: number) => `/work/p${index}`;
    const repositories = Array.from({ length: 11 }, (_, index) => make(index));
    const base = twoProjects();
    mount({
      ...base,
      projects: repositories.map((repository, index) => ({
        repository,
        totals: totalsOf((index + 1) * 1000, 1000),
        perTask: perTask(1000, 1000),
      })),
      series: [
        {
          day: '2026-06-01',
          start: 1,
          tokens: 66_000,
          agentMs: 0,
          tasks: 11,
          models: [],
          projects: repositories.map((repository, index) => ({
            repository,
            tokens: (index + 1) * 1000,
            agentMs: 0,
            tasks: 1,
          })),
        },
      ],
    });
    const chart = await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    const legend = chart.parentElement!.querySelector('ul')!;
    expect(within(legend as HTMLElement).getAllByRole('listitem')).toHaveLength(9);
    expect(within(legend as HTMLElement).getByText('Other')).toBeTruthy();
    const projects = screen.getByRole('table', { name: 'Projects' });
    expect(within(projects).getAllByRole('row')).toHaveLength(1 + 1 + 11);
  });

  it('splits the areas by model', async () => {
    mount(twoProjects());
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    expect(screen.getByRole('radio', { name: 'Projects' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Models' }));
    const chart = screen.getByRole('group', { name: 'Chart by day: Tokens by model' });
    expect(screen.getByTestId('area-series-sonnet')).toBeTruthy();
    expect(screen.getByTestId('area-series-opus')).toBeTruthy();
    expect(screen.getByTestId('slot-2026-06-01')).toBeTruthy();
    expect(screen.getByTestId('slot-2026-06-02')).toBeTruthy();
    fireEvent.focus(chart);
    const tip = within(screen.getByTestId('chart-tooltip'));
    expect(tip.getByText('sonnet')).toBeTruthy();
    expect(tip.getByText('opus')).toBeTruthy();
    expect(tip.getByText('60k')).toBeTruthy();
    expect(tip.getByText('10k')).toBeTruthy();
    expect(tip.getByText('70k')).toBeTruthy();
    expect(tip.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'sonnet60k',
      'opus10k',
    ]);
  });

  it('keeps the tip of the last day inside the chart, so the page gains no horizontal scroll', async () => {
    mount(twoProjects());
    const chart = await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'End' });
    // Half of the widest tip (`max-w-64`) is pulled in from the right edge of the chart: the tip
    // of 256px ends at the edge instead of past it and past the scrollable area of the page.
    expect(Number.parseFloat(screen.getByTestId('chart-tooltip').style.left)).toBe(512);
  });

  it('lists the tip rows from the largest value to the smallest', async () => {
    const base = twoProjects();
    mount({
      ...base,
      series: [
        {
          ...base.series[0]!,
          projects: [
            { repository: '/work/app', tokens: 10_000, agentMs: 0, tasks: 1 },
            { repository: '/work/lib', tokens: 60_000, agentMs: 0, tasks: 1 },
          ],
        },
      ],
    });
    const chart = await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    fireEvent.focus(chart);
    const tip = within(screen.getByTestId('chart-tooltip'));
    expect(tip.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'lib60k',
      'app10k',
    ]);
  });

  it('offers no tasks in the model split and brings them back with the projects', async () => {
    mount(twoProjects());
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    fireEvent.click(screen.getByRole('radio', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Models' }));
    expect(screen.queryByRole('radio', { name: 'Tasks' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Tokens' }).getAttribute('aria-checked')).toBe('true');
    screen.getByRole('group', { name: 'Chart by day: Tokens by model' });
    fireEvent.click(screen.getByRole('radio', { name: 'Projects' }));
    expect(screen.getByRole('radio', { name: 'Tasks' }).getAttribute('aria-checked')).toBe('true');
  });

  it('folds more than eight models into «Other»', async () => {
    const models = Array.from({ length: 10 }, (_, index) => `m${index}`);
    const base = twoProjects();
    mount({
      ...base,
      series: [
        {
          ...base.series[0]!,
          models: models.map((model, index) => ({
            model,
            tokens: (index + 1) * 1000,
            agentMs: 0,
            attempts: 1,
          })),
        },
      ],
    });
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    fireEvent.click(screen.getByRole('radio', { name: 'Models' }));
    const chart = screen.getByRole('group', { name: 'Chart by day: Tokens by model' });
    const legend = chart.parentElement!.querySelector('ul')! as HTMLElement;
    expect(within(legend).getAllByRole('listitem')).toHaveLength(9);
    expect(within(legend).getByText('Other')).toBeTruthy();
  });

  it('labels attempts without a model in the model split', async () => {
    const base = twoProjects();
    mount({
      ...base,
      series: [
        {
          ...base.series[0]!,
          models: [
            { model: 'unknown', tokens: 5000, agentMs: 0, attempts: 1 },
            { model: 'opus', tokens: 3000, agentMs: 0, attempts: 1 },
          ],
        },
      ],
    });
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    fireEvent.click(screen.getByRole('radio', { name: 'Models' }));
    const chart = screen.getByRole('group', { name: 'Chart by day: Tokens by model' });
    const legend = chart.parentElement!.querySelector('ul')! as HTMLElement;
    expect(within(legend).getByText('Unknown model')).toBeTruthy();
    expect(within(legend).queryByText('unknown')).toBeNull();
    fireEvent.focus(chart);
    const tip = within(screen.getByTestId('chart-tooltip'));
    expect(tip.getByText('Unknown model')).toBeTruthy();
    expect(tip.queryByText('unknown')).toBeNull();
  });

  it('switches the metric', async () => {
    mount(twoProjects());
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    fireEvent.click(screen.getByRole('radio', { name: 'Agent time' }));
    const chart = screen.getByRole('group', { name: 'Chart by day: Agent time by project' });
    fireEvent.focus(chart);
    expect(
      within(screen.getByTestId('chart-tooltip')).getAllByText('12 min').length,
    ).toBeGreaterThan(0);
  });

  it('requests report with bucket=auto', async () => {
    const { api } = mount(twoProjects());
    await waitFor(() => expect(api.statsReport).toHaveBeenCalled());
    expect(vi.mocked(api.statsReport).mock.calls[0]?.[0]?.bucket).toBe('auto');
  });

  it('renders 6-hour interval titles and badge', async () => {
    const base = twoProjects();
    mount({
      ...base,
      bucket: '6h',
      series: [
        {
          day: '2026-06-01T00:00',
          start: new Date(2026, 5, 1, 0, 0).getTime(),
          tokens: 10_000,
          agentMs: 1000,
          tasks: 1,
          projects: [{ repository: '/work/app', tokens: 10_000, agentMs: 1000, tasks: 1 }],
          models: [],
        },
        {
          day: '2026-06-01T06:00',
          start: new Date(2026, 5, 1, 6, 0).getTime(),
          tokens: 20_000,
          agentMs: 2000,
          tasks: 1,
          projects: [{ repository: '/work/app', tokens: 20_000, agentMs: 2000, tasks: 1 }],
          models: [],
        },
      ],
    });
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    expect(screen.getByText('6h')).toBeTruthy();
    const slot0 = screen.getByTestId('slot-2026-06-01T00:00');
    expect(slot0.querySelector('title')?.textContent).toContain('00:00–06:00');
    const slot1 = screen.getByTestId('slot-2026-06-01T06:00');
    expect(slot1.querySelector('title')?.textContent).toContain('06:00–12:00');
  });

  it('renders week bucket badge and week range title', async () => {
    const base = twoProjects();
    mount({
      ...base,
      bucket: 'week',
      series: [
        {
          day: '2026-W23',
          start: new Date(2026, 5, 1).getTime(),
          tokens: 30_000,
          agentMs: 3000,
          tasks: 1,
          projects: [{ repository: '/work/app', tokens: 30_000, agentMs: 3000, tasks: 1 }],
          models: [],
        },
      ],
    });
    await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    expect(screen.getByText('by week')).toBeTruthy();
    const slot = screen.getByTestId('slot-2026-W23');
    expect(slot.querySelector('title')?.textContent).toContain('–');
  });

  it('renders a single point with center guide and point markers without crashing', async () => {
    const base = twoProjects();
    mount({
      ...base,
      series: [
        {
          day: '2026-06-01',
          start: new Date(2026, 5, 1).getTime(),
          tokens: 60_000,
          agentMs: 6000,
          tasks: 1,
          projects: [{ repository: '/work/app', tokens: 60_000, agentMs: 6000, tasks: 1 }],
          models: [],
        },
      ],
    });
    const chart = await screen.findByRole('group', { name: 'Chart by day: Tokens by project' });
    expect(screen.getByTestId('area-single-point')).toBeTruthy();
    expect(screen.getByTestId('point-/work/app')).toBeTruthy();
    fireEvent.focus(chart);
    const tip = within(screen.getByTestId('chart-tooltip'));
    expect(tip.getByText('app')).toBeTruthy();
    expect(tip.getAllByText('60k').length).toBeGreaterThanOrEqual(1);
  });
});

describe('shares', () => {
  it('shows the share of a project and the outcomes of the tasks', async () => {
    mount(twoProjects());
    expect(await screen.findByText('90k · 90%')).toBeTruthy();
    expect(screen.getByText('10k · 10%')).toBeTruthy();
    expect(screen.getByTestId('stack-finished')).toBeTruthy();
    expect(screen.getByTestId('stack-failed')).toBeTruthy();
  });

  it('shows no shares for one project', async () => {
    mount(twoProjects({ repository: '/work/app' }), { project: '/work/app' });
    await screen.findByText('Task outcomes', { selector: 'h2' });
    expect(screen.queryByText('Tokens by project', { selector: 'h2' })).toBeNull();
  });
});

describe('tables', () => {
  const projectNames = () =>
    within(screen.getByRole('table', { name: 'Projects' }))
      .getAllByRole('row')
      .slice(1)
      .map((line) => within(line).getAllByRole('cell')[0]?.textContent);

  it('puts all projects first and sorts the rest', async () => {
    mount(twoProjects());
    const table = await screen.findByRole('table', { name: 'Projects' });
    expect(projectNames()).toEqual(['All projects', 'app', 'lib']);
    const header = within(table).getByRole('button', { name: 'Tokens' });
    fireEvent.click(header);
    expect(projectNames()).toEqual(['All projects', 'lib', 'app']);
    fireEvent.click(within(table).getByRole('button', { name: /Tokens/ }));
    expect(projectNames()).toEqual(['All projects', 'app', 'lib']);
    expect(
      within(table)
        .getByRole('columnheader', { name: /Tokens/ })
        .getAttribute('aria-sort'),
    ).toBe('descending');
  });

  it('picks the project by its name', async () => {
    const { onFilter } = mount(twoProjects());
    const table = await screen.findByRole('table', { name: 'Projects' });
    fireEvent.click(within(table).getByRole('button', { name: 'lib' }));
    expect(onFilter).toHaveBeenCalledWith('30d', '/work/lib');
  });

  it('puts the biggest consumer of tokens first when sorted by tokens descending', async () => {
    mount(twoProjects());
    await screen.findByRole('table', { name: 'Projects' });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Models' }), { button: 0, ctrlKey: false });
    const table = await screen.findByRole('table', { name: 'Models' });
    fireEvent.click(within(table).getByRole('button', { name: /Output/ }));
    fireEvent.click(within(table).getByRole('button', { name: /Output/ }));
    const names = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((line) => within(line).getAllByRole('cell')[0]?.textContent);
    expect(names).toEqual(['sonnet', 'opus']);
  });

  it('shows names of the breakdown rows, labels service keys and sorts by the shown text', async () => {
    mount(
      twoProjects({
        bySpecialist: [
          row('coder', 100_000, 150, 'Zed coder'),
          row('naming', 50_000, 10),
          row('plain', 10_000, 10),
        ],
        byModel: [row('unknown', 5_000, 10), row('opus', 20_000, 50)],
        byRuntime: [row('command', 1_000, 10), row('claude', 99_000, 10)],
      }),
    );
    await screen.findByRole('table', { name: 'Projects' });
    const names = (table: HTMLElement) =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((line) => within(line).getAllByRole('cell')[0]?.textContent);
    const specialists = await screen.findByRole('table', { name: 'Specialists' });
    expect(names(specialists)).toEqual(['Zed coder', 'Run naming', 'plain']);
    expect(within(specialists).getByText('Zed coder').getAttribute('title')).toBe('coder');
    fireEvent.click(within(specialists).getByRole('button', { name: 'Name' }));
    expect(names(specialists)).toEqual(['plain', 'Run naming', 'Zed coder']);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Models' }), { button: 0, ctrlKey: false });
    expect(names(await screen.findByRole('table', { name: 'Models' }))).toEqual([
      'opus',
      'Unknown model',
    ]);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Runtimes' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(names(await screen.findByRole('table', { name: 'Runtimes' }))).toEqual([
      'Claude',
      'Command',
    ]);
  });
});

describe('clearing', () => {
  async function ask() {
    const report = twoProjects();
    const statsReport = vi.fn(async () => report);
    const statsClear = vi.fn(async () => ({ removed: 12 }));
    const api = fakeApi({ statsReport, statsClear });
    render(
      <StatsPage
        api={api}
        registry={registry}
        runs={[]}
        period="30d"
        project={null}
        onFilter={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Clear statistics of lib' }));
    return { api, statsReport };
  }

  it('clears after the confirmation, tells how many records went and reads again', async () => {
    const { api, statsReport } = await ask();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Clear the statistics of lib?')).toBeTruthy();
    expect(within(dialog).getByText(/The runs stay/)).toBeTruthy();
    expect(api.statsClear).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(api.statsClear).toHaveBeenCalledWith('/work/lib'));
    expect(await screen.findByText(/12 records removed/)).toBeTruthy();
    await waitFor(() => expect(statsReport).toHaveBeenCalledTimes(2));
  });

  it('changes nothing when the question is refused', async () => {
    const { api, statsReport } = await ask();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.statsClear).not.toHaveBeenCalled();
    expect(statsReport).toHaveBeenCalledTimes(1);
  });
});

describe('states', () => {
  it('shows a skeleton while the report loads', () => {
    const api = fakeApi({ statsReport: vi.fn(() => new Promise<StatsReportView>(() => {})) });
    render(
      <StatsPage
        api={api}
        registry={registry}
        runs={[]}
        period="30d"
        project={null}
        onFilter={() => {}}
      />,
    );
    expect(screen.getByRole('status', { name: 'Loading statistics' })).toBeTruthy();
  });

  it('says there is no data for the period instead of empty charts', async () => {
    mount(statsReportView());
    expect(await screen.findByText('No data for the period')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('kpi-tile')).toBeNull();
  });

  it('warns that collection is off and still shows the collected data', async () => {
    mount(
      twoProjects({
        settings: { enabled: false, exclude: [], backfilledAt: null },
      }),
    );
    expect(await screen.findByText('Statistics collection is off')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the settings' }).getAttribute('href')).toBe(
      '#settings/global/system',
    );
    expect(screen.getByText('Tokens per task')).toBeTruthy();
  });

  it('shows the error and reads again on «Retry»', async () => {
    const statsReport = vi
      .fn()
      .mockRejectedValueOnce(new Error('daemon is down'))
      .mockResolvedValueOnce(twoProjects());
    const api = fakeApi({ statsReport });
    render(
      <StatsPage
        api={api}
        registry={registry}
        runs={[]}
        period="30d"
        project={null}
        onFilter={() => {}}
      />,
    );
    expect(await screen.findByText(/daemon is down/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Tokens per task')).toBeTruthy();
    expect(screen.queryByText(/daemon is down/)).toBeNull();
  });

  it('has no scroll area of its own: the shell scrolls the page', async () => {
    const api = fakeApi({ statsReport: vi.fn().mockResolvedValue(twoProjects()) });
    render(
      <StatsPage
        api={api}
        registry={registry}
        runs={[]}
        period="30d"
        project={null}
        onFilter={() => {}}
      />,
    );
    await screen.findByText('Tokens per task');
    const page = screen.getByTestId('stats-page');
    expect(page.className).not.toMatch(/overflow-y-(auto|scroll)/);
  });
});
