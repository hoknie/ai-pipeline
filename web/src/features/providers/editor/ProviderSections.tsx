import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '../../../shared/ui/layout/card.tsx';
import { FORM_STEPS, type FormStep } from '../form/draft.ts';

/** The three parts of an existing provider, each in its own card under a heading. */
export function ProviderSections({ sections }: { sections: Record<FormStep, ReactNode> }) {
  const { t } = useTranslation();
  return (
    <>
      {FORM_STEPS.map((step) => (
        <Card key={step} className="p-4">
          <section aria-labelledby={`provider-section-${step}`} className="flex flex-col gap-3">
            <h3 id={`provider-section-${step}`} className="text-sm font-semibold">
              {t(`providers.form.step.${step}`)}
            </h3>
            {sections[step]}
          </section>
        </Card>
      ))}
    </>
  );
}
