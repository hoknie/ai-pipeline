import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type {
  EditorSpecialist,
  SpecialistTagEntry,
  SpecialistTagFolderView,
} from '../../../shared/api/types.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Skeleton } from '../../../shared/ui/feedback/skeleton.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Checkbox } from '../../../shared/ui/forms/checkbox.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../shared/ui/overlays/dialog.tsx';
import { RepositoryPicker } from '../../repositories/index.ts';
import { SpecialistTagChip } from '../SpecialistTagChip.tsx';
import { tagsOfSpecialist } from '../specialistTags.ts';
import { useSpecialistImport } from './useSpecialistImport.ts';

const NO_WAITING: ReadonlyMap<string, number> = new Map();

function ImportRow({
  entry,
  taken,
  disabled,
  checked,
  onToggle,
}: {
  entry: SpecialistTagEntry;
  taken: boolean;
  disabled: boolean;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = `import-${entry.slug}`;
  const tags = tagsOfSpecialist({ shared_tags: [], own_tags: entry.tags });
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1">
      <Checkbox
        id={id}
        disabled={disabled}
        checked={checked}
        onCheckedChange={(on) => onToggle(on === true)}
      />
      <Label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1 font-normal">
        <span className="truncate font-medium">{entry.name ?? entry.slug}</span>
        <span className="truncate text-xs text-muted-foreground">
          {entry.slug}
          {taken ? ` · ${t('specialists.import.taken')}` : ''}
          {entry.error ? ` · ${entry.error}` : ''}
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
}

type Import = ReturnType<typeof useSpecialistImport>;

/** The source repository and its specialists to choose from. */
function ImportBody({ state, current }: { state: Import; current: SpecialistTagFolderView }) {
  const { t } = useTranslation();
  const path = current.repository as string;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-source">{t('specialists.import.source')}</Label>
        <RepositoryPicker
          id="import-source"
          label={t('specialists.import.source')}
          repositories={state.others.map((folder) => folder.repository as string)}
          value={path}
          waiting={NO_WAITING}
          onChange={state.choose}
        />
      </div>
      {current.specialists.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('specialists.import.empty', { name: repositoryLabel(path) })}
        </p>
      ) : (
        <ul aria-label={t('specialists.import.list')} className="flex flex-col gap-1">
          {current.specialists.map((entry) => {
            const taken = state.taken.has(entry.slug);
            return (
              <ImportRow
                key={entry.slug}
                entry={entry}
                taken={taken}
                disabled={taken || entry.error !== undefined || state.busy}
                checked={state.chosen.includes(entry.slug)}
                onToggle={(on) => state.toggle(entry.slug, on)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Copies project specialists of another repository of the registry into this one. */
export function SpecialistImportDialog(props: {
  /** Bound to the repository the specialists are imported into. */
  api: Api;
  repository: string;
  /** The specialists of that repository: a slug with a project file there is taken. */
  specialists: readonly EditorSpecialist[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (slugs: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const state = useSpecialistImport(props);
  const { loadError, folders, current, message, errors } = state;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        aria-describedby="import-about"
      >
        <DialogHeader>
          <DialogTitle>{t('specialists.import.title')}</DialogTitle>
          <DialogDescription id="import-about">{t('specialists.import.about')}</DialogDescription>
        </DialogHeader>
        {loadError ? (
          <Alert variant="destructive">{loadError}</Alert>
        ) : folders === null ? (
          <div role="status" aria-label={t('settings.editor.loading')}>
            <Skeleton className="h-24" />
          </div>
        ) : current === null ? (
          <p className="text-sm text-muted-foreground">{t('specialists.import.noSources')}</p>
        ) : (
          <ImportBody state={state} current={current} />
        )}
        {message ? <Alert variant="destructive">{message}</Alert> : null}
        {errors.length > 0 ? (
          <Alert variant="destructive">
            <ul>
              {errors.map((error) => (
                <li key={`${error.path}:${error.message}`}>
                  <code>{error.path}</code>: {error.message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={state.busy || state.chosen.length === 0}
            onClick={() => void state.run()}
          >
            {t('specialists.import.run', { total: state.chosen.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
