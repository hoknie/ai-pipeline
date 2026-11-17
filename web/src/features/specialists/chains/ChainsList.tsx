import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EditorChain, EntryLevel } from '../../../shared/api/types.ts';
import type { GroupInfo } from '../../../shared/lib/catalog/projectRows.ts';
import { ProjectChips, ReadOnlyHint } from '../../repositories/index.ts';
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
  readOnly = false,
  onNew,
  onSelect,
  onProviders,
}: {
  chains: (EditorChain & GroupInfo)[];
  loaded: boolean;
  selected: string | null;
  /** The mode «All projects»: nothing is created here. */
  readOnly?: boolean;
  onNew?: () => void;
  onSelect: (slug: string) => void;
  /** Opens the tab «Providers» of the window; the hint of an empty list links to it. */
  onProviders?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {readOnly ? (
        <ReadOnlyHint />
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!loaded} onClick={onNew}>
            <Plus />
            {t('chains.new')}
          </Button>
        </div>
      )}
      {loaded && chains.length === 0 ? (
        <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
          <p>{t('swarm.hints.needProvider')}</p>
          {onProviders ? (
            <button type="button" className="underline" onClick={onProviders}>
              {t('swarm.hints.toProviders')}
            </button>
          ) : null}
        </div>
      ) : null}
      <EntryList
        label={t('chains.list')}
        selected={selected}
        onSelect={onSelect}
        entries={chains.map((chain) => {
          const mode =
            chain.raw.mode === 'round_robin' ||
            chain.raw.mode === 'random' ||
            chain.raw.mode === 'by_provider'
              ? chain.raw.mode
              : 'on_error';
          const modeLabel = t(`chains.modes.${mode}`);
          return {
            id: chain.slug,
            title: String(chain.raw.name || chain.slug),
            subtitle: subtitleOf(chain, modeLabel),
            tag: t(`settings.editor.levels.${chain.level}`),
            extra:
              chain.presences || chain.raw.enabled === false ? (
                <span className="flex flex-wrap items-center gap-1">
                  {chain.presences ? (
                    <ProjectChips
                      everywhere={chain.everywhere === true}
                      presences={chain.presences}
                      className="contents"
                    />
                  ) : null}
                  {chain.raw.enabled === false ? (
                    <Badge variant="mute">{t('chains.disabled')}</Badge>
                  ) : null}
                </span>
              ) : null,
          };
        })}
      />
    </>
  );
}
