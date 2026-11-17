import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConfigEditorResponse, ProvidersView } from '../../../shared/api/types.ts';
import { ProvidersMatrix } from '../matrix/ProvidersMatrix.tsx';
import { EmptyProviders } from './EmptyProviders.tsx';
import { ProviderFormPage } from './ProviderFormPage.tsx';

/** The right part of the tab «Providers»: the form of the open provider, else the matrix. */
export function ProviderPane(props: {
  api: Api;
  repository: string | null;
  /** The project whose file the form writes in the mode «All projects»; else the repository. */
  owner: string | null;
  selected: string | null;
  preset: string | null;
  usage: ((slug: string) => ReactNode) | undefined;
  hrefOfNew: ((preset: string | null) => string) | undefined;
  ready: boolean;
  rowCount: number;
  view: ProvidersView | null;
  editor: ConfigEditorResponse | null;
  narrow: boolean;
  onSelect: (
    run: string | null,
    section?: string | null,
    preset?: string | null,
    project?: string | null,
  ) => void;
}) {
  const { api, repository, owner, selected, onSelect } = props;
  const { t } = useTranslation();
  if (selected !== null) {
    return (
      <ProviderFormPage
        key={`${owner ?? ''}:${selected}`}
        api={owner === repository ? api : api.forRepository(owner)}
        repository={owner}
        slug={selected === 'new' ? null : selected}
        preset={props.preset}
        usage={selected === 'new' ? undefined : props.usage?.(selected)}
        onLeave={() => onSelect(null)}
      />
    );
  }
  if (!props.ready || props.view === null) return null;
  if (props.rowCount === 0) {
    return (
      <EmptyProviders
        onCreate={(preset) => onSelect('new', null, preset)}
        {...(props.hrefOfNew ? { hrefOfNew: props.hrefOfNew } : {})}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('providers.detailsEmpty')}</p>
      <ProvidersMatrix
        api={api}
        repository={repository}
        view={props.view}
        editor={props.editor}
        narrow={props.narrow}
        onRoles={() => onSelect(null, 'roles')}
      />
    </div>
  );
}
