import { useTranslation } from 'react-i18next';

import type { ObserversView } from '../../../shared/api/observerTypes.ts';
import { repositoryLabel } from '../../../shared/lib/catalog/repositories.ts';
import { Card } from '../../../shared/ui/layout/card.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';
import { Switch } from '../../../shared/ui/forms/switch.tsx';
import { Errors } from './Errors.tsx';
import type { ErrorGroups, Form } from './form.ts';

/** The switch and the limits of the observers. */
function LimitsCard({
  form,
  update,
  busy,
  errors,
}: {
  form: Form;
  update: (patch: Partial<Form>) => void;
  busy: boolean;
  errors: ErrorGroups;
}) {
  const { t } = useTranslation();
  const { at } = errors;
  return (
    <Card>
      <section className="flex flex-col gap-4 p-4" aria-label={t('observers.tabs.general')}>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Switch
              id="observers-enabled"
              checked={form.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => update({ enabled })}
            />
            <Label htmlFor="observers-enabled">{t('observers.enabled.label')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('observers.enabled.hint')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="observers-workers">{t('observers.workers.label')}</Label>
          <Input
            id="observers-workers"
            type="number"
            min={1}
            max={20}
            className="w-32"
            value={form.workers}
            disabled={busy}
            aria-invalid={at('workers').length > 0}
            onChange={(event) => update({ workers: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t('observers.workers.hint')}</p>
          <Errors errors={at('workers')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="observers-max-repairs">{t('observers.maxRepairs.label')}</Label>
          <Input
            id="observers-max-repairs"
            type="number"
            min={1}
            max={50}
            className="w-32"
            value={form.maxRepairs}
            disabled={busy}
            aria-invalid={at('maxRepairs').length > 0}
            onChange={(event) => update({ maxRepairs: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">{t('observers.maxRepairs.hint')}</p>
          <Errors errors={at('maxRepairs')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Switch
              id="observers-human-only"
              checked={form.answerHumanOnly}
              disabled={busy}
              onCheckedChange={(answerHumanOnly) => update({ answerHumanOnly })}
            />
            <Label htmlFor="observers-human-only">{t('observers.humanOnly.label')}</Label>
          </div>
          <p className="text-xs text-muted-foreground">{t('observers.humanOnly.hint')}</p>
        </div>
      </section>
    </Card>
  );
}

/** The observers that work now and those that wait. */
function RunningCard({ view }: { view: ObserversView }) {
  const { t } = useTranslation();
  const { running, waiting } = view.workers;
  return (
    <Card>
      <section
        className="flex flex-col gap-2 p-4"
        aria-label={t('observers.running.title')}
        data-testid="observers-running"
      >
        <h3 className="text-sm font-semibold">{t('observers.running.title')}</h3>
        {running.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('observers.running.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {running.map((item) => (
              <li key={`${item.runId}:${item.incident.key}`}>
                <span className="font-medium" title={item.repository}>
                  {repositoryLabel(item.repository)}
                </span>{' '}
                · <code>{item.runId}</code> · {t(`observers.incident.${item.incident.kind}`)} ·{' '}
                {item.incident.group}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground" data-testid="observers-waiting">
          {t('observers.running.waiting', { count: waiting })}
        </p>
      </section>
    </Card>
  );
}

/** The switch, the limits, and the observers that work now. */
export function GeneralTab({
  form,
  update,
  busy,
  errors,
  view,
}: {
  form: Form;
  update: (patch: Partial<Form>) => void;
  busy: boolean;
  errors: ErrorGroups;
  view: ObserversView;
}) {
  return (
    <>
      <LimitsCard form={form} update={update} busy={busy} errors={errors} />
      <RunningCard view={view} />
    </>
  );
}
