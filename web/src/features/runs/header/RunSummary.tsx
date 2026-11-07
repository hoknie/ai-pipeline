import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';

import { cost, duration, runClockEnd, usageText } from '../../../shared/lib/format.ts';
import type { GroupRow, RunView, SystemStepRow } from '../../../shared/api/types.ts';
import { FilePath } from '../../../shared/ui/layout/FilePath.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { DiffStat } from '../files/DiffStat.tsx';
import { RunStatuses } from '../list/RunStatuses.tsx';

/** Downloading the patch of the run as a file. */
function useRunDownload(run: RunView, api?: Api, onError?: (message: string) => void) {
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!api) return;
    setDownloading(true);
    try {
      const { blob, fileName } = await api.runPatch(run.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError?.((error as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  return { downloading, download };
}

/** The summary block of a run: statuses, path, time, tokens and cost. */
export function RunSummary({
  run,
  now,
  entry = null,
  onSelect,
  api,
  onError,
}: {
  run: RunView;
  now: number;
  api?: Api;
  onError?: (message: string) => void;
  entry?: GroupRow | SystemStepRow | null;
  onSelect?: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const { downloading, download } = useRunDownload(run, api, onError);
  const tokens = usageText(run.usage);
  const price = cost(run.usage);
  const rows: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: 'status',
      label: t('runs.header.summary.status'),
      value: <RunStatuses run={run} entry={entry} onSelect={onSelect} layout="rows" />,
    },
    {
      key: 'changes',
      label: t('runs.header.summary.changes'),
      value: (
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {run.diff ? <DiffStat diff={run.diff} /> : <span>—</span>}
          <Button
            variant="outline"
            size="sm"
            loading={downloading}
            disabled={run.delivery.merged === 0 || !api}
            onClick={() => void download()}
          >
            <Download aria-hidden />
            {t('runs.header.summary.download')}
          </Button>
        </span>
      ),
    },
    {
      key: 'path',
      label: t('runs.header.summary.path'),
      value: <FilePath path={run.repository} variant="line" />,
    },
    {
      key: 'time',
      label: t('runs.header.summary.time'),
      value: duration(runClockEnd(run, now) - run.createdAt),
    },
    ...(tokens ? [{ key: 'tokens', label: t('runs.header.summary.tokens'), value: tokens }] : []),
    ...(price ? [{ key: 'cost', label: t('runs.header.summary.cost'), value: price }] : []),
  ];
  return (
    <aside
      aria-label={t('runs.header.summary.label')}
      className="shrink-0 border-l pl-4 @3xl:w-[28rem]"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-foreground tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
