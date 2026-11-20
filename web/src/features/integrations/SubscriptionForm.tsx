import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NewSubscription } from '../../shared/api/api.ts';
import type { ConnectionView, RepositoryView } from '../../shared/api/types.ts';
import { Button } from '../../shared/ui/forms/button.tsx';

import { EventChecks } from './EventChecks.tsx';
import { kindTitle } from './kindLabels.ts';
import { SelectField } from './SelectField.tsx';

const ALL = '';

/** A new subscription: a connection, one project or all of them, the events. */
export function SubscriptionForm({
  connections,
  registry,
  onAdd,
}: {
  connections: readonly ConnectionView[];
  registry: readonly RepositoryView[];
  onAdd: (subscription: NewSubscription) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [connection, setConnection] = useState(connections[0]?.id ?? '');
  const [project, setProject] = useState(ALL);
  const [events, setEvents] = useState<string[]>(['question']);
  const chosen = connections.find((one) => one.id === connection) ?? connections[0];
  // a project connection can only subscribe its own project
  const projects =
    chosen?.project != null ? registry.filter((one) => one.path === chosen.project) : registry;
  const canAll = chosen?.project == null;
  const selected = canAll ? project : (chosen?.project ?? ALL);
  const disabled = chosen === undefined || events.length === 0 || (!canAll && selected === ALL);
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      aria-label={t('integrations.subscriptions.add')}
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen === undefined) return;
        void onAdd({
          connection: chosen.id,
          ...(selected === ALL ? {} : { repository: selected }),
          events,
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <SelectField
          id="new-subscription-connection"
          label={t('integrations.subscriptions.connection')}
          value={chosen?.id ?? ''}
          onChange={setConnection}
        >
          {connections.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name} ({kindTitle(t, one.kind)})
            </option>
          ))}
        </SelectField>
        <SelectField
          id="new-subscription-project"
          label={t('integrations.subscriptions.project')}
          value={selected}
          onChange={setProject}
        >
          {canAll ? (
            <option value={ALL}>{t('integrations.subscriptions.allProjects')}</option>
          ) : null}
          {projects.map((one) => (
            <option key={one.path} value={one.path}>
              {one.name}
            </option>
          ))}
        </SelectField>
      </div>
      <EventChecks idPrefix="new-subscription" value={events} onChange={setEvents} />
      <div>
        <Button type="submit" size="sm" disabled={disabled}>
          {t('integrations.subscriptions.create')}
        </Button>
      </div>
    </form>
  );
}
