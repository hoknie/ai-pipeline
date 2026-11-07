import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { ConfigErrors, EntryList } from '../../../shared/ui/layout/EntryList.tsx';
import { NEW_SHARED } from './constants.ts';
import type { SharedSpecialistsState } from './useSharedSpecialists.ts';

/** The side of the group: the errors of the files, the new specialist, the search and the list. */
export function SharedSpecialistsSide({
  state,
  selected,
}: {
  state: SharedSpecialistsState;
  selected: string | null;
}) {
  const { t } = useTranslation();
  const { fileErrors, search, setSearch, shared, shown, go } = state;
  return (
    <>
      {fileErrors.length > 0 ? <ConfigErrors errors={fileErrors} /> : null}
      <Button onClick={() => void go(NEW_SHARED)}>
        <Plus />
        {t('specialists.new')}
      </Button>
      <Input
        type="search"
        value={search}
        aria-label={t('sharedSpecialists.search')}
        placeholder={t('sharedSpecialists.search')}
        onChange={(event) => setSearch(event.target.value)}
      />
      {shared.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sharedSpecialists.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sharedSpecialists.nothing')}</p>
      ) : null}
      <EntryList
        label={t('sharedSpecialists.list')}
        selected={selected}
        onSelect={(slug) => void go(slug)}
        entries={shown.map((entry) => ({
          id: entry.slug,
          title: String(entry.raw.name ?? entry.slug),
          subtitle: entry.slug,
        }))}
      />
    </>
  );
}
