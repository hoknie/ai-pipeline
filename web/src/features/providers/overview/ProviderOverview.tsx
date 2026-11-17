import { useTranslation } from 'react-i18next';

import type { ProviderView, ProvidersView } from '../../../shared/api/types.ts';
import type { Grouped } from '../../../shared/lib/catalog/projectRows.ts';
import { EntryOverview } from '../../repositories/index.ts';
import { ProvidersMatrix } from '../matrix/ProvidersMatrix.tsx';
import type { Api } from '../../../shared/api/api.ts';

function ProviderBlocks({
  row,
  highlight,
  onOpen,
}: {
  row: Grouped<ProviderView>;
  highlight: string | null;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <EntryOverview
      title={row.name}
      id={row.slug}
      row={row}
      highlight={highlight}
      onOpen={onOpen}
      describe={(provider) => {
        const active = provider.active === null ? undefined : provider.access[provider.active];
        const runtime = active?.runtime ?? (active ? 'API' : '—');
        const count = Object.keys(provider.models ?? {}).length;
        return `${runtime} · ${t('projectOverview.models', { count })}`;
      }}
    />
  );
}

/**
 * The right part of the tab «Providers» in the mode «All projects»: the overview of the open
 * provider, else the matrix of the shared level, read only.
 */
export function ProvidersOverviewPane(props: {
  api: Api;
  repository: string | null;
  rows: Grouped<ProviderView>[];
  selected: string | null;
  highlight: string | null;
  view: ProvidersView | null;
  narrow: boolean;
  ready: boolean;
  onOpen: (path: string) => void;
  onRoles: () => void;
}) {
  const row = props.rows.find((item) => item.slug === props.selected);
  if (row) {
    return <ProviderBlocks row={row} highlight={props.highlight} onOpen={props.onOpen} />;
  }
  if (!props.ready || props.view === null) return null;
  return (
    <div className="flex flex-col gap-4">
      <ProvidersMatrix
        api={props.api}
        repository={props.repository}
        view={props.view}
        editor={null}
        narrow={props.narrow}
        readOnly
        onRoles={props.onRoles}
      />
    </div>
  );
}
