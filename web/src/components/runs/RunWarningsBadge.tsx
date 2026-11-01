import { useTranslation } from 'react-i18next';

import type { RunView } from '../../types.ts';
import { StatusBadge } from '../StatusBadge.tsx';

/** Total of the group warnings of a finished run; the run state does not depend on them. */
export function RunWarningsBadge({ run }: { run: RunView }) {
  const { t } = useTranslation();
  if (run.state !== 'finished' && run.state !== 'failed') return null;
  const n = run.groups.reduce((sum, group) => sum + group.warnings, 0);
  if (n === 0) return null;
  return <StatusBadge status="warnings" label={t('status.warnings', { n })} />;
}
