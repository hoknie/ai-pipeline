import { Download, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { formatBytes } from '../../../shared/lib/format.ts';
import type { AttachmentView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';

/** Pictures a browser shows safely; SVG is left out, it can carry scripts. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** The biggest text file shown as text; bigger ones are only downloaded. */
export const ATTACHMENT_TEXT_LIMIT = 1024 * 1024;

const isText = (file: AttachmentView) => /\.(md|txt|log)$/i.test(file.fileName);

/** The text of an attachment, loaded when the line is shown. */
function TextPreview({ api, runId, file }: { api: Api; runId: string; file: AttachmentView }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    fetch(api.attachmentUrl(runId, file.id, true), { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.statusText);
        return response.text();
      })
      .then(
        (text) => !stopped && setState({ text }),
        (failure: Error) => !stopped && setState({ error: failure.message }),
      );
    return () => {
      stopped = true;
    };
  }, [api, runId, file.id]);
  if (state === null) {
    return <p className="text-sm text-muted-foreground">{t('attachments.loading')}</p>;
  }
  if ('error' in state) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('attachments.previewFailed', { message: state.error })}
      </p>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto rounded border bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
      {state.text}
    </pre>
  );
}

/** The picture or the text of an attachment; other files have no preview. */
function Preview({ api, runId, file }: { api: Api; runId: string; file: AttachmentView }) {
  const { t } = useTranslation();
  if (IMAGE_TYPES.has(file.mediaType)) {
    const url = api.attachmentUrl(runId, file.id, true);
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={t('attachments.open', { name: file.fileName })}
      >
        <img
          src={url}
          alt={t('attachments.preview', { name: file.fileName })}
          loading="lazy"
          className="max-h-48 max-w-full rounded border object-contain"
        />
      </a>
    );
  }
  if (isText(file) && file.size <= ATTACHMENT_TEXT_LIMIT) {
    return <TextPreview api={api} runId={runId} file={file} />;
  }
  return null;
}

/** The files attached to the task of the run: a download link for each, a preview where possible. */
export function AttachmentsTab({
  api,
  runId,
  attachments,
}: {
  api: Api;
  runId: string;
  attachments: AttachmentView[];
}) {
  const { t, i18n } = useTranslation();
  return (
    <ul aria-label={t('attachments.listOfRun')} className="flex flex-col gap-3">
      {attachments.map((file) => (
        <li
          key={file.id}
          className="flex flex-col gap-2 rounded-md border bg-card p-3"
          data-attachment={file.fileName}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Paperclip className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium break-all">{file.fileName}</span>
            <span className="text-xs text-muted-foreground">
              {formatBytes(file.size, t, i18n.language)} · {file.mediaType}
            </span>
            <Button variant="outline" size="sm" className="ml-auto" asChild>
              <a
                href={api.attachmentUrl(runId, file.id)}
                download={file.fileName}
                aria-label={`${t('attachments.download')} ${file.fileName}`}
              >
                <Download />
                {t('attachments.download')}
              </a>
            </Button>
          </div>
          <Preview api={api} runId={runId} file={file} />
        </li>
      ))}
    </ul>
  );
}
