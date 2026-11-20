import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { ConnectionView } from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { checkCodeText } from '../kindLabels.ts';

/** «text (code)» for a known code, the plain «failed: code» for an unknown one. */
function failedText(t: TFunction, code: string): string {
  const text = checkCodeText(t, code);
  return text === code ? t('integrations.check.failed', { code }) : `${text} (${code})`;
}

/** The last check of a connection: when, and «ok, N tools» or the static code of the failure. */
export function CheckStatus({ check }: { check: ConnectionView['lastCheck'] }) {
  const { t } = useTranslation();
  if (check === null) {
    return <p className="text-xs text-muted-foreground">{t('integrations.check.never')}</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant={check.ok ? 'ok' : 'err'}>
        {check.ok
          ? t('integrations.check.ok', { count: check.count ?? 0 })
          : failedText(t, check.code ?? 'error')}
      </Badge>
      <span className="text-muted-foreground">{new Date(check.at).toLocaleString()}</span>
    </p>
  );
}
