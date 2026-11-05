import { Download, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../api.ts';
import { dateTime, formatBytes, when } from '../../format.ts';
import { useMediaQuery } from '../../media.ts';
import type { ArtifactView } from '../../types.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog.tsx';
import { Empty } from '../../ui/empty.tsx';
import { Markdown } from '../Markdown.tsx';

/** The biggest artifact the panel loads for a preview; bigger ones are only downloaded. */
export const ARTIFACT_PREVIEW_LIMIT = 1024 * 1024;

const head = 'px-2 py-1.5 font-medium';

/** Text of the opened artifact, or why there is none. */
function Preview({ api, runId, group, artifact }: PreviewProps) {
  const { t, i18n } = useTranslation();
  const tooLarge = artifact.size > ARTIFACT_PREVIEW_LIMIT;
  const [state, setState] = useState<
    { id: string; text: string } | { id: string; error: string } | null
  >(null);
  useEffect(() => {
    if (tooLarge) return;
    let stopped = false;
    api.artifactText(runId, group, artifact.id).then(
      (text) => !stopped && setState({ id: artifact.id, text }),
      (failure: Error) => !stopped && setState({ id: artifact.id, error: failure.message }),
    );
    return () => {
      stopped = true;
    };
  }, [api, runId, group, artifact.id, artifact.createdAt, artifact.size, tooLarge]);
  if (tooLarge) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">
          {t('runs.group.artifactTooLarge', {
            limit: formatBytes(ARTIFACT_PREVIEW_LIMIT, t, i18n.language),
          })}
        </p>
        <DownloadLink api={api} runId={runId} group={group} artifact={artifact} />
      </div>
    );
  }
  if (state === null || state.id !== artifact.id) {
    return <p className="text-sm text-muted-foreground">{t('runs.group.artifactLoading')}</p>;
  }
  if ('error' in state) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('runs.group.artifactFailed', { message: state.error })}
      </p>
    );
  }
  return artifact.preview === 'markdown' ? (
    <Markdown text={state.text} />
  ) : (
    <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">{state.text}</pre>
  );
}

function DownloadLink({ api, runId, group, artifact }: PreviewProps) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" asChild>
      <a
        href={api.artifactUrl(runId, group, artifact.id)}
        download={artifact.fileName}
        aria-label={`${t('runs.group.artifactDownload')} ${artifact.fileName}`}
      >
        <Download />
        {t('runs.group.artifactDownload')}
      </a>
    </Button>
  );
}

interface PreviewProps {
  api: Api;
  runId: string;
  group: string;
  artifact: ArtifactView;
}

function PreviewHeader({ onClose, ...props }: PreviewProps & { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-medium">{props.artifact.title}</h3>
        <p className="font-mono text-xs text-muted-foreground">{props.artifact.fileName}</p>
      </div>
      <div className="flex gap-1">
        <DownloadLink {...props} />
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('runs.group.artifactClose')}
        </Button>
      </div>
    </div>
  );
}

export function ArtifactsTab({
  api,
  runId,
  group,
  count,
  revision,
  onError,
}: {
  api: Api;
  runId: string;
  group: string;
  /** Number of artifacts of the group in the row; a change reloads the list. */
  count: number;
  /** Changes when an artifact is replaced; reloads the list. */
  revision: number;
  onError: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const wide = useMediaQuery('(min-width: 768px)');
  const [artifacts, setArtifacts] = useState<ArtifactView[] | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    api.groupArtifacts(runId, group).then(
      (next) => !stopped && setArtifacts(next),
      (failure: Error) => !stopped && onError(failure.message),
    );
    return () => {
      stopped = true;
    };
  }, [api, runId, group, count, revision, onError]);

  if (artifacts === null) {
    return <p className="text-sm text-muted-foreground">{t('runs.group.artifactLoading')}</p>;
  }
  if (artifacts.length === 0) {
    return <Empty title={t('runs.group.artifacts')}>{t('runs.group.artifactsEmpty')}</Empty>;
  }
  const now = Date.now();
  const current = artifacts.find((artifact) => artifact.id === opened) ?? null;
  const preview = current ? (
    <section
      aria-label={t('runs.group.artifactPreview', { file: current.fileName })}
      className="flex flex-col gap-3 rounded-md border bg-card p-4 text-card-foreground"
    >
      <PreviewHeader
        api={api}
        runId={runId}
        group={group}
        artifact={current}
        onClose={() => setOpened(null)}
      />
      <Preview api={api} runId={runId} group={group} artifact={current} />
    </section>
  ) : null;
  return (
    <div className="flex flex-col gap-3">
      <table aria-label={t('runs.group.artifactsList')} className="w-full text-left text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className={head}>{t('runs.group.artifactStep')}</th>
            <th className={head}>{t('runs.group.artifactTitle')}</th>
            <th className={head}>{t('runs.group.artifactFile')}</th>
            <th className={head}>{t('runs.group.artifactCreated')}</th>
            <th className={`${head} text-right`}>{t('runs.group.artifactSize')}</th>
            <th className={head}>
              <span className="sr-only">{t('runs.group.artifactOpen')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <tr key={artifact.id} className="border-b last:border-0 hover:bg-muted/50">
              <td className="px-2 py-1.5" title={`${artifact.step} · ${artifact.specialist}`}>
                {artifact.stepName} · #{artifact.seq}
              </td>
              <td className="px-2 py-1.5">{artifact.title}</td>
              <td className="px-2 py-1.5">
                <code className="rounded bg-muted px-1 font-mono text-xs">{artifact.fileName}</code>
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                <time
                  dateTime={new Date(artifact.createdAt).toISOString()}
                  title={dateTime(artifact.createdAt, i18n.language)}
                >
                  {when(artifact.createdAt, now, i18n.language)}
                </time>
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                {formatBytes(artifact.size, t, i18n.language)}
              </td>
              <td className="px-2 py-1.5">
                <div className="flex justify-end gap-1">
                  {artifact.preview !== null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t('runs.group.artifactOpen')} ${artifact.fileName}`}
                      onClick={() => setOpened(artifact.id === opened ? null : artifact.id)}
                    >
                      <Eye />
                      {t('runs.group.artifactOpen')}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href={api.artifactUrl(runId, group, artifact.id)}
                      download={artifact.fileName}
                      aria-label={`${t('runs.group.artifactDownload')} ${artifact.fileName}`}
                    >
                      <Download />
                      {t('runs.group.artifactDownload')}
                    </a>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {wide ? (
        preview
      ) : current ? (
        <Dialog open onOpenChange={(open) => !open && setOpened(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{current.title}</DialogTitle>
              <p className="font-mono text-xs text-muted-foreground">{current.fileName}</p>
            </DialogHeader>
            <div className="flex">
              <DownloadLink api={api} runId={runId} group={group} artifact={current} />
            </div>
            <Preview api={api} runId={runId} group={group} artifact={current} />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
