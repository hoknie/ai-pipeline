import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NewWebhook } from '../../../shared/api/api.ts';
import type { RepositoryView } from '../../../shared/api/types.ts';
import { Button } from '../../../shared/ui/forms/button.tsx';
import { Input } from '../../../shared/ui/forms/input.tsx';
import { Label } from '../../../shared/ui/forms/label.tsx';

import { EventChecks } from '../EventChecks.tsx';
import { SelectField } from '../SelectField.tsx';

const ALL = '';

/** A new webhook: a name, the address, one project or all of them, the events. No secret field. */
export function WebhookForm({
  registry,
  onAdd,
}: {
  registry: readonly RepositoryView[];
  onAdd: (webhook: NewWebhook) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [project, setProject] = useState(ALL);
  const [events, setEvents] = useState<string[]>(['question']);
  const disabled = name.trim() === '' || url.trim() === '' || events.length === 0;
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      aria-label={t('integrations.webhooks.add')}
      onSubmit={(event) => {
        event.preventDefault();
        void onAdd({
          name: name.trim(),
          url: url.trim(),
          ...(project === ALL ? {} : { repository: project }),
          events,
        }).then((ok) => {
          if (!ok) return;
          setName('');
          setUrl('');
        });
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-40 flex-col gap-1">
          <Label htmlFor="new-webhook-name">{t('integrations.webhooks.name')}</Label>
          <Input id="new-webhook-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <Label htmlFor="new-webhook-url">{t('integrations.webhooks.url')}</Label>
          <Input
            id="new-webhook-url"
            value={url}
            maxLength={2048}
            placeholder="https://"
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <SelectField
          id="new-webhook-project"
          label={t('integrations.subscriptions.project')}
          value={project}
          onChange={setProject}
        >
          <option value={ALL}>{t('integrations.subscriptions.allProjects')}</option>
          {registry.map((one) => (
            <option key={one.path} value={one.path}>
              {one.name}
            </option>
          ))}
        </SelectField>
      </div>
      <EventChecks idPrefix="new-webhook" value={events} onChange={setEvents} />
      <div>
        <Button type="submit" size="sm" disabled={disabled}>
          {t('integrations.webhooks.create')}
        </Button>
      </div>
    </form>
  );
}
