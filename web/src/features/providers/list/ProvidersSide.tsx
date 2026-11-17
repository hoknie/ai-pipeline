import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { ReadOnlyHint } from '../../repositories/index.ts';
import { ProvidersList, type ProviderRow } from './ProvidersList.tsx';

/** Whether a row matches the words typed in the search: by name or slug. */
export function matchesRow(row: ProviderRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${row.provider.name} ${row.provider.slug}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The column on the left: «Create provider», the search and the providers. */
export function ProvidersSide({
  rows,
  selected,
  onOpen,
  readOnly = false,
  onNew,
}: {
  rows: ProviderRow[];
  selected: string | null;
  onOpen: (row: ProviderRow) => void;
  /** The mode «All projects»: nothing is created here. */
  readOnly?: boolean;
  onNew?: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const shown = rows.filter((row) => matchesRow(row, query));
  return (
    <div className="flex flex-col gap-3">
      {readOnly ? (
        <ReadOnlyHint />
      ) : (
        <Button onClick={onNew}>
          <Plus /> {t('providers.createButton')}
        </Button>
      )}
      {rows.length > 0 ? (
        <Input
          type="search"
          value={query}
          aria-label={t('providers.search')}
          placeholder={t('providers.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {rows.length > 0 ? (
        <ProvidersList rows={shown} selected={selected} narrow onOpen={onOpen} />
      ) : null}
    </div>
  );
}
