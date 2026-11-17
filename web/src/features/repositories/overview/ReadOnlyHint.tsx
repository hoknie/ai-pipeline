import { useTranslation } from 'react-i18next';

/** Above a list of the mode «All projects», instead of the buttons that create entries. */
export function ReadOnlyHint() {
  const { t } = useTranslation();
  return (
    <p data-read-only-hint className="text-sm text-muted-foreground">
      {t('projectOverview.hint')}
    </p>
  );
}
