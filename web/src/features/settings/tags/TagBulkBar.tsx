import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import type { useTagSelection } from './useTagSelection.ts';

/** The actions on the selected tags; shown only while something is selected. */
export function TagBulkBar({ selection }: { selection: ReturnType<typeof useTagSelection> }) {
  const { t } = useTranslation();
  const { selected, busy, error, clear, removeSelected } = selection;
  if (selected.length === 0) return null;
  return (
    <div data-tag-bulk className="flex flex-col gap-1 rounded-md border bg-card px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {t('tags.settings.selected', { count: selected.length })}
        </span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={clear}>
          {t('tags.settings.clearSelection')}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => void removeSelected()}
        >
          {t('tags.settings.removeSelected')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
