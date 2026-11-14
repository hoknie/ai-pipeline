import { Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { formatBytes } from '../../../shared/lib/format.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import type { AttachmentView } from '../../../shared/api/types.ts';
import type { AttachmentEntry } from '../draft.ts';
import type { FormState } from './TaskFields.tsx';
import { useAttachmentUploads } from './useAttachmentUploads.ts';

function EntryLine({ entry, onRemove }: { entry: AttachmentEntry; onRemove: () => void }) {
  const { t, i18n } = useTranslation();
  const sending = entry.upload === null && entry.error === null;
  return (
    <li className="flex items-center gap-2 text-sm" data-attachment={entry.fileName}>
      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{entry.fileName}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatBytes(entry.size, t, i18n.language)}
      </span>
      {sending ? (
        <progress
          className="h-1.5 w-20"
          max={100}
          value={entry.progress}
          aria-label={t('attachments.uploading', { name: entry.fileName })}
        />
      ) : null}
      {entry.error !== null ? (
        <span role="alert" className="text-xs text-destructive">
          {t('attachments.failed', { error: entry.error })}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        aria-label={`${t('attachments.remove')} ${entry.fileName}`}
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}

function ExistingLine({
  file,
  removed,
  locked,
  onToggle,
}: {
  file: AttachmentView;
  removed: boolean;
  locked: boolean;
  onToggle: (removed: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const label = removed ? t('attachments.restore') : t('attachments.remove');
  return (
    <li
      className="flex items-center gap-2 text-sm"
      data-attachment={file.fileName}
      data-removed={removed || undefined}
    >
      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className={removed ? 'truncate line-through' : 'truncate'}>{file.fileName}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatBytes(file.size, t, i18n.language)}
      </span>
      {locked ? null : (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label={`${label} ${file.fileName}`}
          onClick={() => onToggle(removed)}
        >
          {removed ? label : <X />}
        </Button>
      )}
    </li>
  );
}

/**
 * The files of the task: a button and a drop zone, the files of the item already, and the files
 * picked, each sent to the panel as soon as it is picked. A returned run shows its files only.
 */
export function AttachmentFields({ state, api }: { state: FormState; api: Api }) {
  const { t } = useTranslation();
  const { idPrefix, effective, change, locked } = state;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const files = useAttachmentUploads(
    api,
    {
      entries: effective.attachments ?? [],
      existing: effective.existing ?? [],
      detached: effective.detached ?? [],
    },
    change,
  );
  const entries = effective.attachments ?? [];
  const existing = effective.existing ?? [];
  if (locked && existing.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-attachments`}>{t('attachments.label')}</Label>
      {locked ? null : (
        <div
          data-dropzone=""
          data-over={over || undefined}
          className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 data-[over]:bg-muted"
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            files.add([...event.dataTransfer.files]);
          }}
        >
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            <Paperclip />
            {t('attachments.attach')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('attachments.drop')}</span>
          <input
            ref={input}
            id={`${idPrefix}-attachments`}
            type="file"
            multiple
            hidden
            data-testid={`${idPrefix}-attachments-input`}
            onChange={(event) => {
              files.add([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
        </div>
      )}
      {files.problem ? (
        <p role="alert" className="text-xs text-destructive">
          {files.problem}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1" aria-label={t('attachments.list')}>
        {existing.map((file) => (
          <ExistingLine
            key={file.id}
            file={file}
            removed={(effective.detached ?? []).includes(file.fileName)}
            locked={locked}
            onToggle={(removed) =>
              removed ? files.restore(file.fileName) : files.detach(file.fileName)
            }
          />
        ))}
        {entries.map((entry) => (
          <EntryLine key={entry.key} entry={entry} onRemove={() => files.remove(entry.key)} />
        ))}
      </ul>
    </div>
  );
}
