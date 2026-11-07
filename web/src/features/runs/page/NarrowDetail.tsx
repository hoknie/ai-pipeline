import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/ui/forms/button.tsx';

/** The open run on the whole screen of a narrow window, with the way back to the list. */
export function NarrowDetail({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col">
      <Button variant="ghost" size="sm" className="m-2 w-fit" onClick={onBack}>
        <ArrowLeft />
        {t('runs.page.back')}
      </Button>
      {children}
    </div>
  );
}
