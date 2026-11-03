import { useTranslation } from 'react-i18next';

import { files } from '../../format.ts';

/** Changes of a group: the number of files in bold, added lines green, removed red. */
export function DiffStat({ diff }: { diff: { files: number; added: number; removed: number } }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <strong className="font-semibold text-foreground">{files(diff.files, t)}</strong>{' '}
      <span className="text-status-ok">+{diff.added}</span>{' '}
      <span className="text-status-err">−{diff.removed}</span>
    </span>
  );
}
