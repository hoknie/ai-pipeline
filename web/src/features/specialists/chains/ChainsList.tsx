import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EditorChain, EntryLevel } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { EntryList } from '../../../shared/ui/layout/EntryList.tsx';

export const LEVEL_KEYS: Record<EntryLevel, EntryLevel> = {
  project: 'project',
  global: 'global',
  project_over_global: 'project_over_global',
};

export const NEW_CHAIN = 'new';

function subtitleOf(chain: EditorChain, modeLabel: string): string {
  const runtimes = Array.isArray(chain.raw.runtimes) ? chain.raw.runtimes.length : 0;
  return `${chain.slug} · ${modeLabel} · ${runtimes}`;
}

export function ChainsList({
  chains,
  loaded,
  selected,
  onNew,
  onSelect,
}: {
  chains: EditorChain[];
  loaded: boolean;
  selected: string | null;
  onNew: () => void;
  onSelect: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex gap-2">
        <Button className="flex-1" disabled={!loaded} onClick={onNew}>
          <Plus />
          {t('chains.new')}
        </Button>
      </div>
      <EntryList
        label={t('chains.list')}
        selected={selected}
        onSelect={onSelect}
        entries={chains.map((chain) => {
          const mode =
            chain.raw.mode === 'round_robin' || chain.raw.mode === 'random'
              ? chain.raw.mode
              : 'on_error';
          const modeLabel = t(`chains.modes.${mode}`);
          return {
            id: chain.slug,
            title: String(chain.raw.name || chain.slug),
            subtitle: subtitleOf(chain, modeLabel),
            tag: t(`settings.editor.levels.${chain.level}`),
            extra:
              chain.raw.enabled === false ? (
                <Badge variant="mute">{t('chains.disabled')}</Badge>
              ) : null,
          };
        })}
      />
    </>
  );
}
