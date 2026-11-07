import { useTranslation } from 'react-i18next';

import type { Api } from '../../shared/api/api.ts';
import { useTags } from '../../shared/lib/catalog/tags.tsx';
import { Card } from '../../shared/ui/layout/card.tsx';
import { Empty } from '../../shared/ui/feedback/empty.tsx';
import { TagRow } from './tags/TagRow.tsx';
import { useTagEdits } from './tags/useTagEdits.ts';

/** The tag catalog of one project: rename, recolor, delete. */
export function TagsSettings({ api, repository }: { api: Api; repository: string }) {
  const { t } = useTranslation();
  const catalog = useTags();
  const edits = useTagEdits(api, repository);
  const own = catalog.of(repository);
  const ordinary = own.filter((tag) => !tag.task);
  const linked = own.filter((tag) => tag.task);

  return (
    <section aria-label={t('tags.settings.label')} className="flex flex-col gap-3">
      <Card>
        <section aria-labelledby="tags-ordinary" className="flex flex-col gap-2 p-4">
          <h3 id="tags-ordinary" className="text-sm font-semibold">
            {t('tags.settings.ordinaryTitle')}
          </h3>
          {ordinary.length === 0 ? (
            <Empty title={t('tags.none')} />
          ) : (
            <ul className="flex flex-col divide-y">
              {ordinary.map((tag) => (
                <TagRow key={tag.id} tag={tag} withColor edits={edits} />
              ))}
            </ul>
          )}
        </section>
      </Card>
      {linked.length > 0 ? (
        <Card>
          <section aria-labelledby="tags-linked" className="flex flex-col gap-2 p-4">
            <h3 id="tags-linked" className="text-sm font-semibold">
              {t('tags.settings.linkedTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('tags.settings.linkedHint')}</p>
            <ul className="flex flex-col divide-y">
              {linked.map((tag) => (
                <TagRow key={tag.id} tag={tag} withColor={false} edits={edits} />
              ))}
            </ul>
          </section>
        </Card>
      ) : null}
    </section>
  );
}
