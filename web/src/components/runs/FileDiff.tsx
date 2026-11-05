import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn.ts';
import type { FileDiffView } from '../../types.ts';

import { parseHunks } from './diffLines.ts';

export type FileDiffState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; diff: FileDiffView };

const ROW_CLASS = {
  ctx: '',
  add: 'bg-status-ok/10',
  del: 'bg-status-err/10',
  note: 'text-muted-foreground italic',
} as const;

const SIGN = { ctx: ' ', add: '+', del: '−', note: '' } as const;

/** The diff of one file: hunks with line numbers, or a note when there is nothing to show. */
export function FileDiff({ result }: { result: FileDiffState }) {
  const { t } = useTranslation();
  if (result.state === 'loading') {
    return (
      <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
        {t('runs.files.diffLoading')}
      </p>
    );
  }
  if (result.state === 'error') {
    return (
      <p role="alert" className="px-3 py-2 text-xs text-status-err">
        {t('runs.files.diffUnavailable')}: {result.message}
      </p>
    );
  }
  const { diff } = result;
  if (diff.binary) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t('runs.files.diffBinary')}</p>;
  }
  const hunks = parseHunks(diff.lines);
  if (hunks.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t('runs.files.diffEmpty')}</p>;
  }
  return (
    <div className="overflow-x-auto border-t bg-background font-mono text-xs">
      {hunks.map((hunk, index) => (
        <table key={index} className="w-full border-collapse">
          <caption className="bg-muted px-3 py-0.5 text-left text-muted-foreground">
            {hunk.header}
          </caption>
          <tbody>
            {hunk.rows.map((row, position) => (
              <tr key={position} data-kind={row.kind} className={cn(ROW_CLASS[row.kind])}>
                <td className="w-10 select-none px-2 text-right text-muted-foreground">
                  {row.old ?? ''}
                </td>
                <td className="w-10 select-none px-2 text-right text-muted-foreground">
                  {row.new ?? ''}
                </td>
                <td className="w-4 select-none text-center">{SIGN[row.kind]}</td>
                <td className="whitespace-pre pr-3">{row.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {diff.truncated ? (
        <p className="border-t px-3 py-1 text-muted-foreground">
          {t('runs.files.diffTruncated', { shown: diff.lines.length, total: diff.totalLines })}
        </p>
      ) : null}
    </div>
  );
}
