import { useState } from 'react';

import type { Api } from '../../../shared/api/api.ts';
import type { EditorPipeline } from '../../../shared/api/types.ts';
import type { Grouped } from '../../../shared/lib/catalog/projectRows.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import type { ActionEntry } from '../../../shared/lib/pipeline/pipelineEntries.ts';
import {
  ConfigPicker,
  SHARED_CHOICE,
  configChoices,
  initialChoice,
  sharedView,
} from '../../repositories/index.ts';
import type { PipelinesData } from '../page/usePipelinesData.ts';
import { PipelinePreview } from './PipelinePreview.tsx';

type Entry = { id: string; level: 'global' | 'project' | 'project_over_global' };

/** The overview of an entry: its name, the choice of the configuration and a read-only preview. */
function EntryConfigs({
  api,
  projects,
  row,
  title,
  highlight,
  isAction,
  onOpen,
}: {
  api: Api;
  projects: NonNullable<PipelinesData['projects']>;
  row: Grouped<Entry>;
  title: string;
  highlight: string | null | undefined;
  isAction: boolean;
  onOpen: (path: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const choices = configChoices(row, highlight ?? null);
  const active =
    choices.find((choice) => choice.value === chosen) ??
    initialChoice(choices, row, highlight ?? null);
  const source = projects.find((entry) => entry.project.path === active?.project.path);
  return (
    <section aria-label={title} data-entry-overview={row.id} className="flex flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{row.id}</p>
      </header>
      {active ? (
        <ConfigPicker choices={choices} active={active} onChoose={setChosen} onOpen={onOpen} />
      ) : null}
      {source?.view && active ? (
        <PipelinePreview
          key={`${active.value}:${row.id}`}
          api={api}
          project={source.project}
          choice={active.value}
          view={
            active.value === SHARED_CHOICE
              ? sharedView(source.view, isAction ? 'actions' : 'pipelines', row.id)
              : source.view
          }
          id={row.id}
          isAction={isAction}
        />
      ) : null}
    </section>
  );
}

/** A pipeline of the mode «All projects», read only: the choice of the configuration and its form. */
export function PipelineOverview({
  api,
  projects,
  row,
  highlight,
  onOpen,
}: {
  api: Api;
  projects: NonNullable<PipelinesData['projects']>;
  row: Grouped<EditorPipeline>;
  highlight: string | null | undefined;
  onOpen: (path: string) => void;
}) {
  return (
    <EntryConfigs
      api={api}
      projects={projects}
      row={row}
      title={rawName(row.raw) ?? row.id}
      highlight={highlight}
      isAction={false}
      onOpen={onOpen}
    />
  );
}

/** An action of the mode «All projects», read only. */
export function ActionOverview({
  api,
  projects,
  row,
  highlight,
  onOpen,
}: {
  api: Api;
  projects: NonNullable<PipelinesData['projects']>;
  row: Grouped<ActionEntry>;
  highlight: string | null | undefined;
  onOpen: (path: string) => void;
}) {
  const name = typeof row.raw.name === 'string' && row.raw.name !== '' ? row.raw.name : row.id;
  return (
    <EntryConfigs
      api={api}
      projects={projects}
      row={row}
      title={name}
      highlight={highlight}
      isAction
      onOpen={onOpen}
    />
  );
}
