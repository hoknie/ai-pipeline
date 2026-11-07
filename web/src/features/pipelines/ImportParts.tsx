import { useTranslation } from 'react-i18next';

import type { EditorPipeline, FieldError } from '../../shared/api/types.ts';
import { Alert } from '../../shared/ui/feedback/alert.tsx';
import { Checkbox } from '../../shared/ui/forms/checkbox.tsx';
import { Label } from '../../shared/ui/forms/label.tsx';
import { Skeleton } from '../../shared/ui/feedback/skeleton.tsx';
import { repositoryLabel } from '../../shared/lib/catalog/repositories.ts';
import { RepositoryPicker } from '../repositories/index.ts';
import { rawName } from '../../shared/lib/pipeline/pipelineName.ts';
import { SpecialistTagChip, tagsOfSpecialist } from '../specialists/index.ts';

/** The project pipelines of the source; the ones the repository already has are disabled. */
export function ImportEntries(props: {
  entries: EditorPipeline[];
  taken: ReadonlySet<string>;
  chosen: string[];
  busy: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <ul aria-label={t('pipelines.import.list')} className="flex flex-col gap-1">
      {props.entries.map((entry) => {
        const busyId = props.taken.has(entry.id);
        const id = `import-${entry.id}`;
        const tags = tagsOfSpecialist({ shared_tags: [], own_tags: entry.own_tags });
        return (
          <li key={entry.id} className="flex items-start gap-2 rounded-md px-1 py-1">
            <Checkbox
              id={id}
              disabled={busyId || props.busy}
              checked={props.chosen.includes(entry.id)}
              onCheckedChange={(on) => props.onToggle(entry.id, on === true)}
            />
            <Label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1 font-normal">
              <span className="truncate font-medium">
                {rawName(entry.sources.project?.raw ?? entry.raw) ?? entry.id}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {entry.id}
                {busyId ? ` · ${t('pipelines.import.taken')}` : ''}
              </span>
              {tags.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <SpecialistTagChip key={tag.name} name={tag.name} />
                  ))}
                </span>
              ) : null}
            </Label>
          </li>
        );
      })}
    </ul>
  );
}

export function ImportErrors({ errors }: { errors: FieldError[] }) {
  if (errors.length === 0) return null;
  return (
    <Alert variant="destructive">
      <ul>
        {errors.map((error) => (
          <li key={`${error.path}:${error.message}`}>
            <code>{error.path}</code>: {error.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

const NO_WAITING: ReadonlyMap<string, number> = new Map();

/** The body of the dialog: the loading state, the repository to take from and its pipelines. */
export function ImportSource(props: {
  loadError: string | null;
  repositories: string[] | null;
  others: string[];
  current: string | null;
  entries: EditorPipeline[] | null;
  taken: ReadonlySet<string>;
  chosen: string[];
  busy: boolean;
  onChoose: (path: string) => void;
  onToggle: (id: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const { current, entries } = props;
  if (props.loadError) return <Alert variant="destructive">{props.loadError}</Alert>;
  if (props.repositories === null) {
    return (
      <div role="status" aria-label={t('settings.editor.loading')}>
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (current === null)
    return <p className="text-sm text-muted-foreground">{t('pipelines.import.noSources')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-source">{t('pipelines.import.source')}</Label>
        <RepositoryPicker
          id="import-source"
          label={t('pipelines.import.source')}
          repositories={props.others}
          value={current}
          waiting={NO_WAITING}
          onChange={props.onChoose}
        />
      </div>
      {entries === null ? (
        <div role="status" aria-label={t('settings.editor.loading')}>
          <Skeleton className="h-16" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('pipelines.import.empty', { name: repositoryLabel(current) })}
        </p>
      ) : (
        <ImportEntries
          entries={entries}
          taken={props.taken}
          chosen={props.chosen}
          busy={props.busy}
          onToggle={props.onToggle}
        />
      )}
    </div>
  );
}
