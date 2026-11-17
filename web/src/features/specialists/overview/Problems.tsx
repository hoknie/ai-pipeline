import { useTranslation } from 'react-i18next';

import { Alert } from '../../../shared/ui/feedback/alert.tsx';
import { ConfigErrors } from '../../../shared/ui/layout/EntryList.tsx';
import type { SpecialistsSource } from '../page/useAllSpecialistsData.ts';

/** The failures of loading and the errors of the configuration above a list. */
export function Problems({ data }: { data: SpecialistsSource }) {
  const { view, failure, failures } = data;
  return (
    <>
      {failure ? <Alert variant="destructive">{failure}</Alert> : null}
      {failures.length > 0 && view ? (
        <Alert variant="destructive">{failures.join('\n')}</Alert>
      ) : null}
      {view ? <ConfigErrors errors={view.errors} /> : null}
    </>
  );
}

export function UnknownProject() {
  const { t } = useTranslation();
  return (
    <div className="px-4">
      <Alert variant="destructive" role="alert">
        {t('specialists.projectNotFound')}
      </Alert>
    </div>
  );
}
