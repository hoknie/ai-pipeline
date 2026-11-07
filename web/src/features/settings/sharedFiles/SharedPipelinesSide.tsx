import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SpecialistTagChip } from '../../specialists/index.ts';
import { rawName } from '../../../shared/lib/pipeline/pipelineName.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { ConfigErrors, EntryList } from '../../../shared/ui/layout/EntryList.tsx';
import { NEW_SHARED_PIPELINE } from './constants.ts';
import type { SharedPipelinesState } from './useSharedPipelines.ts';

/** The side of the group: the errors of the files, the new pipeline, the search and the list. */
export function SharedPipelinesSide({
  state,
  selected,
}: {
  state: SharedPipelinesState;
  selected: string | null;
}) {
  const { t } = useTranslation();
  const { fileErrors, search, setSearch, shared, shown, go } = state;
  return (
    <>
      {fileErrors.length > 0 ? <ConfigErrors errors={fileErrors} /> : null}
      <Button onClick={() => void go(NEW_SHARED_PIPELINE)}>
        <Plus />
        {t('pipelines.new')}
      </Button>
      <Input
        type="search"
        value={search}
        aria-label={t('sharedPipelines.search')}
        placeholder={t('sharedPipelines.search')}
        onChange={(event) => setSearch(event.target.value)}
      />
      {shared.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sharedPipelines.empty')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('sharedPipelines.nothing')}</p>
      ) : null}
      <EntryList
        label={t('sharedPipelines.list')}
        selected={selected}
        onSelect={(id) => void go(id)}
        entries={shown.map((entry) => ({
          id: entry.id,
          title: rawName(entry.raw) ?? entry.id,
          subtitle: entry.id,
          extra:
            entry.shared_tags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {entry.shared_tags.map((tag) => (
                  <SpecialistTagChip key={tag} name={tag} />
                ))}
              </span>
            ) : undefined,
        }))}
      />
    </>
  );
}
