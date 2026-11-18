import { CheckCircle2, CircleSlash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../../../shared/ui/feedback/badge.tsx';

/** The state of a runtime: an icon and the text «Enabled» or «Disabled». */
export function RuntimeStatus({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const Icon = enabled ? CheckCircle2 : CircleSlash;
  return (
    <Badge variant={enabled ? 'ok' : 'mute'} className="w-fit">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {enabled ? t('settingsPage.runtimes.enabled') : t('settingsPage.runtimes.disabled')}
    </Badge>
  );
}
