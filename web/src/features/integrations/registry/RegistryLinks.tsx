import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ProjectLinkView, RepositoryView } from '../../../shared/api/types.ts';
import { formatRoute } from '../../../shared/lib/nav/route.ts';
import { messageOf } from '../events.ts';

/**
 * The projects linked to a service registry and why a link is missing. The link is edited in the
 * settings of the project: each row leads there.
 */
export function RegistryLinks({
  api,
  registry,
  version,
}: {
  api: Api;
  registry: readonly RepositoryView[];
  /** Changes when the page did something: the links are read again. */
  version: number;
}) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<ProjectLinkView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api
      .integrationLinks()
      .then((next) => {
        if (!current) return;
        setLinks(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (current) setError(messageOf(failure));
      });
    return () => {
      current = false;
    };
  }, [api, version]);
  if (error !== null) return <p className="text-sm text-status-err">{error}</p>;
  if (links === null) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="registry-links-title">
      <h3 id="registry-links-title" className="text-sm font-semibold">
        {t('integrations.registry.links.title')}
      </h3>
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('integrations.registry.links.empty')}</p>
      ) : (
        <table className="w-full text-left text-sm" data-testid="registry-links">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pr-3 font-normal">{t('integrations.registry.links.project')}</th>
              <th className="pr-3 font-normal">{t('integrations.registry.links.connection')}</th>
              <th className="pr-3 font-normal">{t('integrations.registry.links.path')}</th>
              <th className="pr-3 font-normal">{t('integrations.registry.links.source')}</th>
              <th className="font-normal">{t('integrations.registry.links.status')}</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <LinkRow key={`${link.project}/${link.connection}`} link={link} registry={registry} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function LinkRow({
  link,
  registry,
}: {
  link: ProjectLinkView;
  registry: readonly RepositoryView[];
}) {
  const { t } = useTranslation();
  const project = registry.find((one) => one.path === link.project);
  const href = formatRoute({
    view: 'settings',
    run: 'projects',
    group: 'global',
    step: project?.slug ?? link.project,
    tab: null,
  });
  return (
    <tr className="border-t">
      <td className="py-1 pr-3">
        <a className="underline" href={href}>
          {project?.label ?? link.project}
        </a>
      </td>
      <td className="pr-3">{link.connectionName}</td>
      <td className="pr-3">
        {link.url === null ? (
          (link.registryPath ?? '—')
        ) : (
          <a className="underline" href={link.url} target="_blank" rel="noreferrer">
            {link.registryPath ?? link.url}
          </a>
        )}
      </td>
      <td className="pr-3">
        {link.source === null ? '—' : t(`projects.registry.source.${link.source}`)}
      </td>
      <td>
        {t(`projects.registry.status.${link.status}`)}
        {link.candidates.length > 0 ? `: ${link.candidates.join(', ')}` : ''}
      </td>
    </tr>
  );
}
