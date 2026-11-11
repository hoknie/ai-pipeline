import { Plus, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BrowseDirectories } from '../../../features/repositories/index.ts';
import { cn } from '../../../shared/lib/browser/cn.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { repositoryLabel, repositoryMatches } from '../../../shared/lib/catalog/repositories.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../../shared/ui/overlays/dropdown-menu.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';

import {
  AddRepositoryDialog,
  AddFirstRepository,
  RepositoryList,
  RepositorySearch,
  RepositoryItem,
  RepositoryTrigger,
} from './RepositoryParts.tsx';
import { navRowClass } from '../nav/navRow.ts';

export interface RepositoryChoice {
  /** Repositories to choose from, in display order. */
  repositories: string[];
  /** The path of each repository as shown (home directory as `~`); absent: the path itself. */
  paths?: ReadonlyMap<string, string>;
  /** The selected repository; null until the panel knows its own. */
  selected: string | null;
  /** Runs waiting for an answer, by repository. */
  waiting: ReadonlyMap<string, number>;
  onSelect: (repository: string) => void;
  /** Adds the repository of a path; rejects with the daemon's message when it refuses. */
  onAdd: (path: string) => Promise<void>;
  /** The folder browser of the path field. */
  browse: BrowseDirectories;
}

/** The group «Projects» of the settings, where every project is managed. */
const PROJECTS_LINK = formatRoute({
  view: 'settings',
  run: 'projects',
  group: 'global',
  step: null,
  tab: null,
});

/** Picks the repository whose queue, configuration and pipelines the panel shows. */
export function RepositoryMenu({
  choice,
  compact = false,
}: {
  choice: RepositoryChoice;
  /** The top bar: the button is as wide as the name, which is cut when long. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { repositories, selected, waiting, onSelect } = choice;
  const adder = { onAdd: choice.onAdd, browse: choice.browse };
  const shownPath = (path: string) => choice.paths?.get(path) ?? path;
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  // the menu focuses itself on opening; the search takes the focus after it
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => search.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);
  if (selected === null) return <AddFirstRepository compact={compact} {...adder} />;
  const name = repositoryLabel(selected);
  const others = repositories
    .filter((path) => path !== selected)
    .reduce((sum, path) => sum + (waiting.get(path) ?? 0), 0);
  const matching = repositories.filter((path) => repositoryMatches(path, shownPath(path), query));
  const trigger = (
    <RepositoryTrigger
      name={name}
      label={t('nav.repositoryCurrent', { name })}
      title={selected}
      others={others}
      compact={compact}
    />
  );
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        {trigger}
        <DropdownMenuContent
          align="start"
          aria-label={t('nav.repository')}
          className="w-80 max-w-[calc(100vw-1rem)]"
        >
          <RepositorySearch ref={search} query={query} onQuery={setQuery} />
          <RepositoryList
            matching={matching}
            selected={selected}
            shownPath={shownPath}
            waiting={waiting}
            onSelect={onSelect}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('nav.repositoryAdd')}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={PROJECTS_LINK} data-projects-link>
              <Settings2 aria-hidden />
              {t('nav.repositoryManage')}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddRepositoryDialog open={adding} onOpenChange={setAdding} {...adder} />
    </>
  );
}
