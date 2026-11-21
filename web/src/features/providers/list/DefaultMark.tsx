import { useTranslation } from 'react-i18next';

import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { useProvidersScope } from '../page/scope.ts';

/**
 * The mark of the default provider. In a project, a value that comes from the shared settings
 * says so; a switched-off provider is not used, and the mark says that too.
 */
export function DefaultMark({ level, enabled }: { level: 'global' | 'project'; enabled: boolean }) {
  const { t } = useTranslation();
  const scope = useProvidersScope();
  const shared = scope === 'project' && level === 'global';
  return (
    <Badge variant="ok" title={enabled ? undefined : t('providers.default.markOff')}>
      {shared ? t('providers.default.markShared') : t('providers.default.mark')}
    </Badge>
  );
}
