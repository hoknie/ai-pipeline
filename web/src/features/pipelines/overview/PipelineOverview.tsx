import { useTranslation } from 'react-i18next';

import type { EditorPipeline } from '../../../shared/api/types.ts';
import type { Grouped } from '../../../shared/lib/catalog/projectRows.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import { isCommandAction, type ActionEntry } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import { EntryOverview } from '../../repositories/index.ts';

/** A pipeline of the mode «All projects», read only: the projects that have it and its steps. */
export function PipelineOverview({
  row,
  highlight,
  onOpen,
}: {
  row: Grouped<EditorPipeline>;
  highlight: string | null | undefined;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <EntryOverview
      title={rawName(row.raw) ?? row.id}
      id={row.id}
      row={row}
      highlight={highlight}
      onOpen={onOpen}
      describe={(entry) => {
        const steps = Array.isArray(entry.raw.steps) ? entry.raw.steps.length : 0;
        const text = typeof entry.raw.description === 'string' ? entry.raw.description : '';
        return [t('projectOverview.steps', { count: steps }), text].filter(Boolean).join(' · ');
      }}
    />
  );
}

/** An action of the mode «All projects», read only. */
export function ActionOverview({
  row,
  highlight,
  onOpen,
}: {
  row: Grouped<ActionEntry>;
  highlight: string | null | undefined;
  onOpen: (path: string) => void;
}) {
  const name = typeof row.raw.name === 'string' && row.raw.name !== '' ? row.raw.name : row.id;
  return (
    <EntryOverview
      title={name}
      id={row.id}
      row={row}
      highlight={highlight}
      onOpen={onOpen}
      describe={(entry) =>
        isCommandAction(entry.raw)
          ? `command: ${String(entry.raw.command ?? '')}`
          : `specialist: ${String(entry.raw.specialist)}`
      }
    />
  );
}
