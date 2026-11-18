import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '../../../shared/ui/forms/input.tsx';
import { RuntimesList } from './RuntimesList.tsx';
import { matchesRuntime, type RuntimeRow } from './runtimeRows.ts';

/** The column on the left: the search and the runtimes. */
export function RuntimesSide({
  rows,
  selected,
  titleOf,
  onOpen,
}: {
  rows: RuntimeRow[];
  selected: string | null;
  titleOf: (key: string) => string;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const shown = rows.filter((row) => matchesRuntime(row, titleOf(row.key), query));
  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={query}
        aria-label={t('settingsPage.runtimes.search')}
        placeholder={t('settingsPage.runtimes.search')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <RuntimesList rows={shown} selected={selected} narrow titleOf={titleOf} onOpen={onOpen} />
    </div>
  );
}
