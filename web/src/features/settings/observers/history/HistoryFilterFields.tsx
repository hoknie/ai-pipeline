import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObserverHistoryQuery } from '../../../../shared/api/observerHistoryApi.ts';
import { repositoryLabel } from '../../../../shared/lib/catalog/repositories.ts';
import { ProjectDot } from '../../../../shared/ui/feedback/ProjectDot.tsx';
import { Input } from '../../../../shared/ui/forms/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../shared/ui/forms/select.tsx';

type HistoryControls = {
  filters: ObserverHistoryQuery;
  update: (patch: Partial<ObserverHistoryQuery>) => void;
};

const RESULTS = [
  'running',
  'done',
  'rejected',
  'needs_human',
  'failed',
  'cancelled',
  'unknown',
] as const;
const RUNTIMES = ['claude', 'opencode', 'agy'] as const;
/** The value of «all» in a select: an empty value is not allowed there. */
const ALL = '*';
const CONTROL = 'h-8';

function toDatetimeLocal(ms: number | undefined): string {
  if (ms === undefined) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One choice of a filter, «all» first; `undefined` when «all» is chosen. */
function ChoiceFilter({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: string | undefined;
  options: { value: string; title?: string; content: ReactNode }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : next)}
    >
      <SelectTrigger className={CONTROL} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} title={option.title}>
            {option.content}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A local date and time with a short visible caption and a full accessible name. */
function DateField({
  caption,
  label,
  value,
  onChange,
}: {
  caption: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground @md:w-72">
      <span className="w-6 shrink-0">{caption}</span>
      <Input
        aria-label={label}
        type="datetime-local"
        value={toDatetimeLocal(value)}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).getTime() : undefined)}
        className={`${CONTROL} text-foreground`}
      />
    </label>
  );
}

export function HistoryFilterFields({
  history,
  projects,
}: {
  history: HistoryControls;
  projects: string[];
}) {
  const { t } = useTranslation();
  const { filters, update } = history;
  const projectOptions = projects.map((path) => ({
    value: path,
    title: path,
    content: (
      <span className="flex min-w-0 items-center gap-2">
        <ProjectDot path={path} />
        <span className="truncate">{repositoryLabel(path)}</span>
      </span>
    ),
  }));
  const resultOptions = RESULTS.map((result) => ({
    value: result,
    content: t(`observers.history.results.${result}` as never),
  }));
  const runtimeOptions = RUNTIMES.map((runtime) => ({ value: runtime, content: runtime }));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid min-w-0 grid-cols-1 gap-2 @md:grid-cols-2 @3xl:grid-cols-4">
        <ChoiceFilter
          label={t('observers.history.project')}
          all={t('observers.history.allProjects')}
          value={filters.repository}
          options={projectOptions}
          onChange={(repository) => update({ repository })}
        />
        <ChoiceFilter
          label={t('observers.history.result')}
          all={t('observers.history.allResults')}
          value={filters.result}
          options={resultOptions}
          onChange={(result) => update({ result: result as (typeof RESULTS)[number] | undefined })}
        />
        <ChoiceFilter
          label={t('observers.history.runtime')}
          all={t('observers.history.allRuntimes')}
          value={filters.runtime}
          options={runtimeOptions}
          onChange={(runtime) => update({ runtime })}
        />
        <div className="relative min-w-0">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('observers.history.model')}
            placeholder={t('observers.history.model')}
            value={filters.model ?? ''}
            onChange={(e) => update({ model: e.target.value || undefined })}
            className={`${CONTROL} pl-8`}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2 @md:flex-row @md:flex-wrap">
        <DateField
          caption={t('observers.history.fromShort')}
          label={t('observers.history.from')}
          value={filters.from}
          onChange={(from) => update({ from })}
        />
        <DateField
          caption={t('observers.history.toShort')}
          label={t('observers.history.to')}
          value={filters.to}
          onChange={(to) => update({ to })}
        />
      </div>
    </div>
  );
}
