import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import type { ConnectionView, ProjectLinkView } from '../../../shared/api/types.ts';
import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Field } from './ProjectFields.tsx';

const REGISTRY_KIND = 'service-registry';

/** The path of the project in the registry, its source and the page of the registry that shows it. */
export function RegistryLinkSummary({ link }: { link: ProjectLinkView }) {
  const { t } = useTranslation();
  if (link.registryPath === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-registry-link={link.connection}>
      <code className="min-w-0 truncate" title={link.registryPath}>
        {link.registryPath}
      </code>
      {link.source ? (
        <Badge variant="outline">{t(`projects.registry.source.${link.source}`)}</Badge>
      ) : null}
      {link.url ? (
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          {t('projects.registry.open')}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      ) : null}
    </p>
  );
}

/** The path field with its «Save»; the refusal of the registry is shown at the field. */
function PathField({
  id,
  path,
  error,
  busy,
  onPath,
  onSave,
}: {
  id: string;
  path: string;
  error: string | null;
  busy: boolean;
  onPath: (path: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Field
      id={id}
      label={t('projects.registry.path')}
      hint={t('projects.registry.pathHint')}
      error={error ?? undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          value={path}
          placeholder="acme/backend/api"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => onPath(event.target.value)}
          onKeyDown={(event) => {
            // Enter checks the path here, not the form of the project around it
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (!busy && path.trim() !== '') onSave();
          }}
        />
        <Button type="button" size="sm" disabled={busy || path.trim() === ''} onClick={onSave}>
          {t('projects.registry.save')}
        </Button>
      </div>
    </Field>
  );
}

/** What the matching of the pair ended with, in words, with the candidates when there are some. */
function useStatusText(link: ProjectLinkView | undefined): string {
  const { t } = useTranslation();
  if (link === undefined) return t('projects.registry.status.none');
  const text = t(`projects.registry.status.${link.status}`);
  return link.candidates.length > 0 ? `${text}: ${link.candidates.join(', ')}` : text;
}

/** One registry connection of the project: the link or why there is none, and its three actions. */
function RegistryConnection({
  api,
  project,
  connection,
  link,
  onLink,
}: {
  api: Api;
  project: string;
  connection: ConnectionView;
  link: ProjectLinkView | undefined;
  onLink: (link: ProjectLinkView) => void;
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState(link?.source === 'manual' ? (link.registryPath ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useStatusText(link);

  const act = async (action: Parameters<Api['integrationLink']>[2]) => {
    setBusy(true);
    setError(null);
    try {
      onLink(await api.integrationLink(connection.id, project, action));
      setPath('path' in action ? action.path : '');
    } catch (failure) {
      // a refusal of the registry, the path included, is shown at the field
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="grid gap-2 rounded-md border p-3"
      aria-label={t('projects.registry.connection', { name: connection.name })}
    >
      <h4 className="text-sm font-medium">{connection.name}</h4>
      <p className="text-sm text-muted-foreground" data-registry-status={link?.status ?? 'none'}>
        {status}
      </p>
      {link ? <RegistryLinkSummary link={link} /> : null}
      <PathField
        id={`registry-path-${connection.id}`}
        path={path}
        error={error}
        busy={busy}
        onPath={setPath}
        onSave={() => void act({ path: path.trim() })}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void act({ auto: true })}
        >
          {t('projects.registry.rematch')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void act({ clear: true })}
        >
          {t('projects.registry.reset')}
        </Button>
      </div>
    </section>
  );
}

/**
 * The service registries of a project: for each connection the status of the matching, the link
 * with its source and address, the path field (checked by the registry), «match again» and
 * «reset». Nothing is shown for a project without a registry connection.
 */
export function ProjectRegistry({ api, project }: { api: Api; project: string }) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<ConnectionView[] | null>(null);
  const [links, setLinks] = useState<ProjectLinkView[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([api.integrations(), api.integrationLinks(project)])
      .then(([overview, found]) => {
        if (!live) return;
        setConnections(
          overview.connections.filter(
            (one) =>
              one.kind === REGISTRY_KIND &&
              one.state === 'ready' &&
              (one.scope === 'global' || one.project === project),
          ),
        );
        setLinks(found);
      })
      .catch((error: unknown) => {
        if (live) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, [api, project]);

  const onLink = useCallback(
    (link: ProjectLinkView) =>
      setLinks((current) => [...current.filter((one) => one.connection !== link.connection), link]),
    [],
  );

  if (failure !== null) return <Alert variant="destructive">{failure}</Alert>;
  if (connections === null || connections.length === 0) return null;
  return (
    <div className="grid gap-2" role="group" aria-label={t('projects.registry.title')}>
      <h3 className="text-sm font-semibold">{t('projects.registry.title')}</h3>
      {connections.map((connection) => (
        <RegistryConnection
          key={connection.id}
          api={api}
          project={project}
          connection={connection}
          link={links.find((one) => one.connection === connection.id)}
          onLink={onLink}
        />
      ))}
    </div>
  );
}
