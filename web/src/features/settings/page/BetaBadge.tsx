import { useTranslation } from 'react-i18next';

import { Badge } from '../../../shared/ui/feedback/badge.tsx';

/** The blue mark of a group still in development. */
export function BetaBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="run" data-beta title={t('settingsPage.betaHint')}>
      {t('settingsPage.beta')}
    </Badge>
  );
}
