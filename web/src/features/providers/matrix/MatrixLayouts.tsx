import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProviderView, RoleView } from '../../../shared/api/types.ts';

type Cell = (provider: ProviderView, role: RoleView) => ReactNode;

/** The matrix as a table: roles in rows (the first column sticks), providers in columns. */
export function MatrixTable({
  roles,
  providers,
  cell,
}: {
  roles: RoleView[];
  providers: ProviderView[];
  cell: Cell;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-card p-2 text-left font-medium">
              {t('providers.matrix.role')}
            </th>
            {providers.map((provider) => (
              <th key={provider.slug} scope="col" className="p-2 text-left font-medium">
                {provider.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.slug} className="border-t">
              <th
                scope="row"
                title={role.slug}
                className="sticky left-0 z-10 bg-card p-2 text-left font-medium"
              >
                {role.name}
              </th>
              {providers.map((provider) => (
                <td key={provider.slug} className="p-2 align-top">
                  {cell(provider, role)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The matrix on a narrow screen: a card per provider with a row per role. */
export function MatrixCards({
  roles,
  providers,
  cell,
}: {
  roles: RoleView[];
  providers: ProviderView[];
  cell: Cell;
}) {
  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <article
          key={provider.slug}
          aria-label={provider.name}
          className="flex flex-col gap-2 rounded-lg border bg-card p-3"
        >
          <h3 className="font-medium">{provider.name}</h3>
          {roles.map((role) => (
            <div key={role.slug} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground" title={role.slug}>
                {role.name}
              </span>
              {cell(provider, role)}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
