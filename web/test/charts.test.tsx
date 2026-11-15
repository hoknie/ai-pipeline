// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { AreaChart, BarChart, ShareBars, StackBar } from '../src/shared/ui/charts/index.ts';

import { cleanup, fireEvent, render, screen, within } from './render.tsx';

afterEach(cleanup);

const categories = [
  { key: '2026-06-01', label: 'Jun 1', title: 'Jun 1, 2026' },
  { key: '2026-06-02', label: 'Jun 2', title: 'Jun 2, 2026' },
  { key: '2026-06-03', label: 'Jun 3', title: 'Jun 3, 2026' },
];

const series = [
  { key: 'app', label: 'app', color: '#3b82f6', values: [100, 0, 50] },
  { key: 'lib', label: 'lib', color: '#22c55e', values: [20, 300, 0] },
];

function mount() {
  render(
    <BarChart
      label="Chart by day: Tokens by project"
      categories={categories}
      series={series}
      format={(value) => `${value}t`}
      categoryHead="Day"
      totalLabel="Total"
    />,
  );
  return screen.getByRole('group', { name: 'Chart by day: Tokens by project' });
}

describe('BarChart', () => {
  it('has an accessible name and draws a bar for every day', () => {
    const chart = mount();
    expect(chart.getAttribute('tabindex')).toBe('0');
    for (const category of categories) {
      expect(screen.getByTestId(`bar-${category.key}`)).toBeTruthy();
    }
  });

  it('names the projects in a legend, not by color alone', () => {
    mount();
    expect(screen.getAllByText('app').length).toBeGreaterThan(0);
    expect(screen.getAllByText('lib').length).toBeGreaterThan(0);
  });

  it('shows the first day on focus and the next one after the right arrow', () => {
    const chart = mount();
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    fireEvent.focus(chart);
    const first = within(screen.getByTestId('chart-tooltip'));
    expect(first.getByText('Jun 1, 2026')).toBeTruthy();
    expect(first.getByText('120t')).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    const second = within(screen.getByTestId('chart-tooltip'));
    expect(second.getByText('Jun 2, 2026')).toBeTruthy();
    expect(second.getByText('lib')).toBeTruthy();
    expect(second.queryByText('app')).toBeNull();
    expect(second.getAllByText('300t').length).toBeGreaterThan(0);
    fireEvent.keyDown(chart, { key: 'End' });
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 3, 2026')).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 3, 2026')).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 1, 2026')).toBeTruthy();
  });

  it('shows the tip on hover and hides it when the mouse leaves', () => {
    const chart = mount();
    const bar = screen.getByTestId('bar-2026-06-02').querySelector('rect');
    fireEvent.mouseEnter(bar!);
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 2, 2026')).toBeTruthy();
    fireEvent.mouseLeave(chart);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('has a table with the same values for a screen reader', () => {
    mount();
    const table = screen.getByRole('table', { name: 'Chart by day: Tokens by project' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Day', 'app', 'lib', 'Total']);
    expect(
      within(rows[2]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['0t', '300t', '300t']);
  });
});

function mountArea(customCats = categories, customSeries = series) {
  render(
    <AreaChart
      label="Area chart: Tokens by project"
      categories={customCats}
      series={customSeries}
      format={(value) => `${value}t`}
      categoryHead="Day"
      totalLabel="Total"
    />,
  );
  return screen.getByRole('group', { name: 'Area chart: Tokens by project' });
}

describe('AreaChart', () => {
  it('has an accessible name and renders smooth area paths with gradients', () => {
    const chart = mountArea();
    expect(chart.getAttribute('tabindex')).toBe('0');
    expect(screen.getByTestId('area-series-app')).toBeTruthy();
    expect(screen.getByTestId('area-series-lib')).toBeTruthy();
    for (const cat of categories) {
      expect(screen.getByTestId(`slot-${cat.key}`)).toBeTruthy();
    }
  });

  it('navigates with keyboard showing crosshair, active markers and tooltip', () => {
    const chart = mountArea();
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    fireEvent.focus(chart);
    expect(screen.getByTestId('crosshair')).toBeTruthy();
    const first = within(screen.getByTestId('chart-tooltip'));
    expect(first.getByText('Jun 1, 2026')).toBeTruthy();
    expect(first.getByText('120t')).toBeTruthy();
    expect(screen.getByTestId('marker-app')).toBeTruthy();
    expect(screen.getByTestId('marker-lib')).toBeTruthy();

    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    const second = within(screen.getByTestId('chart-tooltip'));
    expect(second.getByText('Jun 2, 2026')).toBeTruthy();
    expect(second.getByText('lib')).toBeTruthy();
    expect(second.queryByText('app')).toBeNull();
    expect(screen.getByTestId('marker-lib')).toBeTruthy();
    expect(screen.queryByTestId('marker-app')).toBeNull();

    fireEvent.keyDown(chart, { key: 'End' });
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 3, 2026')).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 1, 2026')).toBeTruthy();
  });

  it('shows tooltip on hover and hides on mouse leave', () => {
    const chart = mountArea();
    const slot = screen.getByTestId('slot-2026-06-02').querySelector('rect');
    fireEvent.mouseEnter(slot!);
    expect(within(screen.getByTestId('chart-tooltip')).getByText('Jun 2, 2026')).toBeTruthy();
    fireEvent.mouseLeave(chart);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('renders single point mode with vertical guide line and center markers', () => {
    mountArea([categories[0]!], [{ key: 'app', label: 'app', color: '#3b82f6', values: [100] }]);
    expect(screen.getByTestId('area-single-point')).toBeTruthy();
    expect(screen.getByTestId('point-app')).toBeTruthy();
  });

  it('renders accessible data table', () => {
    mountArea();
    const table = screen.getByRole('table', { name: 'Area chart: Tokens by project' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });

  it('uses safe index-based gradient ids avoiding collisions and malformed url references', () => {
    mountArea(categories, [
      { key: '/work/my repo #1 (prod)', label: 'repo', color: '#ff0000', values: [10, 20, 30] },
    ]);
    const area = screen.getByTestId('area-series-/work/my repo #1 (prod)');
    const fill = area.getAttribute('fill');
    expect(fill).toMatch(/^url\(#[a-zA-Z0-9-_]+-grad-0\)$/);
  });

  it('renders x-axis date labels for all 7 day boundaries without dropping dates on 6h scale', () => {
    const cats28 = Array.from({ length: 28 }, (_, index) => {
      const dayNum = Math.floor(index / 4) + 1;
      const hour = (index % 4) * 6;
      return {
        key: `2026-06-${String(dayNum).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`,
        label: hour === 0 ? `Jun ${dayNum}` : '',
        title: `Jun ${dayNum}, ${hour}:00`,
      };
    });
    const s28 = [
      { key: 'app', label: 'app', color: '#3b82f6', values: new Array<number>(28).fill(10) },
    ];
    mountArea(cats28, s28);
    for (let day = 1; day <= 7; day += 1) {
      expect(screen.getByText(`Jun ${day}`)).toBeTruthy();
    }
  });
});

describe('ShareBars', () => {
  it('writes the value and the percent of every row', () => {
    render(
      <ShareBars
        label="Tokens by project"
        nameHead="Project"
        valueHead="Tokens"
        rows={[
          { key: 'a', label: 'app', color: '#000', value: 90, text: '90k' },
          { key: 'b', label: 'lib', color: '#111', value: 10, text: '10k' },
        ]}
      />,
    );
    expect(screen.getByText('90k · 90%')).toBeTruthy();
    expect(screen.getByLabelText('lib: 10k · 10%')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Tokens by project' })).toBeTruthy();
  });
});

describe('StackBar', () => {
  it('names every part and gives a table', () => {
    render(
      <StackBar
        label="Task outcomes"
        nameHead="Outcome"
        valueHead="Tasks"
        segments={[
          { key: 'finished', label: 'Finished', color: '#0a0', value: 3 },
          { key: 'failed', label: 'Failed', color: '#a00', value: 1 },
          { key: 'cancelled', label: 'Cancelled', color: '#888', value: 0 },
        ]}
      />,
    );
    expect(screen.getAllByText('Finished').length).toBeGreaterThan(0);
    expect(screen.getByTestId('stack-finished').style.width).toBe('75%');
    expect(screen.queryByTestId('stack-cancelled')).toBeNull();
    expect(screen.getByRole('table', { name: 'Task outcomes' })).toBeTruthy();
  });
});
