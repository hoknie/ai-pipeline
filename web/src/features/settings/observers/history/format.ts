import { formatRoute } from '../../../../shared/lib/nav/route.ts';

export const formatRunHref = (runId: string) =>
  formatRoute({ view: 'runs', run: runId, group: '_repair', step: null, tab: null });

export const formatTime = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(ms);

export const formatDuration = (start: number, finish: number | null, now: number) => {
  const total = Math.max(0, Math.floor(((finish ?? now) - start) / 1000));
  let str: string;
  if (total < 60) {
    str = `${total}s`;
  } else if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    str = s > 0 ? `${m}m ${s}s` : `${m}m`;
  } else {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    str = m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return finish === null ? `${str} · …` : str;
};

export const formatUsd = (value: number | null) => {
  if (value === null) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toPrecision(3)}`;
  return `$${value.toFixed(2)}`;
};
