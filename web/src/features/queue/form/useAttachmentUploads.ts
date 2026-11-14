import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Api } from '../../../shared/api/api.ts';
import { formatBytes } from '../../../shared/lib/format.ts';
import type { AttachmentView } from '../../../shared/api/types.ts';
import type { AttachmentEntry } from '../draft.ts';

/** The most attachments a task has, and the largest one; the daemon checks them again. */
export const ATTACHMENTS_PER_TASK = 10;
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

interface Parts {
  entries: AttachmentEntry[];
  existing: AttachmentView[];
  detached: string[];
}

/**
 * The files of a task form: checks each file picked, sends it to the panel at once and keeps
 * the progress in the draft. `change` replaces the parts of the draft that belong to the files.
 */
export function useAttachmentUploads(
  api: Api,
  parts: Parts,
  change: (patch: { attachments?: AttachmentEntry[]; detached?: string[] }) => void,
) {
  const { t, i18n } = useTranslation();
  const [problem, setProblem] = useState<string | null>(null);
  // the callbacks of a long upload must see the list as it is now, not as it was at the pick
  const latest = useRef(parts.entries);
  latest.current = parts.entries;
  const onChange = useRef(change);
  onChange.current = change;
  const counter = useRef(0);

  const commit = (next: AttachmentEntry[]) => {
    latest.current = next;
    onChange.current({ attachments: next });
  };
  const patch = (key: string, changes: Partial<AttachmentEntry>) =>
    commit(latest.current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)));

  const kept = parts.existing.filter((file) => !parts.detached.includes(file.fileName));
  const taken = (name: string) =>
    kept.some((file) => file.fileName === name) ||
    latest.current.some((entry) => entry.error === null && entry.fileName === name);

  const send = (file: File, key: string) => {
    api
      .uploadAttachment(file, (progress) => patch(key, { progress }))
      .then(
        (done) => patch(key, { upload: done.upload, progress: 100 }),
        (failure: Error) => patch(key, { error: failure.message }),
      );
  };

  const add = (files: File[]) => {
    const accepted: { file: File; entry: AttachmentEntry }[] = [];
    let message: string | null = null;
    for (const file of files) {
      const count =
        kept.length +
        latest.current.filter((entry) => entry.error === null).length +
        accepted.length;
      if (file.size > ATTACHMENT_MAX_BYTES) {
        message = t('attachments.tooLarge', {
          name: file.name,
          limit: formatBytes(ATTACHMENT_MAX_BYTES, t, i18n.language),
        });
      } else if (count >= ATTACHMENTS_PER_TASK) {
        message = t('attachments.tooMany', { count: ATTACHMENTS_PER_TASK });
      } else if (taken(file.name) || accepted.some((item) => item.file.name === file.name)) {
        message = t('attachments.duplicate', { name: file.name });
      } else {
        counter.current += 1;
        accepted.push({
          file,
          entry: {
            key: `${file.name}#${counter.current}`,
            fileName: file.name,
            size: file.size,
            progress: 0,
            upload: null,
            error: null,
          },
        });
      }
    }
    setProblem(message);
    if (accepted.length === 0) return;
    commit([...latest.current, ...accepted.map((item) => item.entry)]);
    for (const { file, entry } of accepted) send(file, entry.key);
  };

  return {
    problem,
    add,
    remove: (key: string) => commit(latest.current.filter((entry) => entry.key !== key)),
    detach: (name: string) => onChange.current({ detached: [...parts.detached, name] }),
    restore: (name: string) =>
      onChange.current({ detached: parts.detached.filter((detached) => detached !== name) }),
    kept,
  };
}
