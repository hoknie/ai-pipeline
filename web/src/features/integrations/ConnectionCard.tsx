import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ChannelStateView,
  ConnectionView,
  IntegrationTypeView,
} from '../../shared/api/types.ts';
import { Badge } from '../../shared/ui/feedback/badge.tsx';
import { Button } from '../../shared/ui/forms/button.tsx';
import { Input } from '../../shared/ui/forms/input.tsx';
import { Label } from '../../shared/ui/forms/label.tsx';

import { secretCommand } from './events.ts';

type Param = IntegrationTypeView['params'][number];

/** The values of the form that differ from the connection: what to set, what to remove. */
export function paramsChange(
  params: readonly Param[],
  current: Readonly<Record<string, string>>,
  draft: Readonly<Record<string, string>>,
): { set: Record<string, string>; unset: string[] } {
  const set: Record<string, string> = {};
  const unset: string[] = [];
  for (const param of params) {
    const before = current[param.name] ?? '';
    const after = (draft[param.name] ?? before).trim();
    if (after === before) continue;
    if (after === '') {
      if (!param.required) unset.push(param.name);
    } else {
      set[param.name] = after;
    }
  }
  return { set, unset };
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: Param;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `param-${param.name}`;
  return (
    <div className="flex min-w-48 flex-1 flex-col gap-1">
      <Label htmlFor={id}>
        {param.name}
        {param.required ? ' *' : ''}
      </Label>
      {param.values === undefined ? (
        <Input
          id={id}
          value={value}
          maxLength={param.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <select
          id={id}
          value={value}
          className="h-9.5 rounded-md border border-input bg-card px-2 text-sm"
          onChange={(event) => onChange(event.target.value)}
        >
          {param.required ? null : <option value="" />}
          {param.values.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ChannelBadge({ channel }: { channel: ChannelStateView | null }) {
  const { t } = useTranslation();
  if (channel === null) return <Badge variant="mute">{t('integrations.channel.none')}</Badge>;
  return channel.state === 'listening' ? (
    <Badge variant="ok">{t('integrations.channel.listening')}</Badge>
  ) : (
    <Badge variant="err" title={channel.error ?? undefined}>
      {t('integrations.channel.error')}
    </Badge>
  );
}

function SecretList({ connection }: { connection: ConnectionView }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {connection.secrets.map((secret) => (
        <li key={secret.slot} className="flex flex-wrap items-center gap-2">
          <span>{secret.slot}</span>
          <Badge variant={secret.present ? 'ok' : 'warn'}>
            {secret.present ? t('integrations.secret.set') : t('integrations.secret.missing')}
          </Badge>
          {secret.present ? null : (
            <span className="text-xs text-muted-foreground">
              {t('integrations.secret.hint')}{' '}
              <code>{secretCommand(connection.id, secret.slot)}</code>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One connection: where it works, its channel and secrets, and its non-secret parameters. */
export function ConnectionCard({
  connection,
  type,
  channel,
  onEdit,
}: {
  connection: ConnectionView;
  type: IntegrationTypeView | undefined;
  channel: ChannelStateView | null;
  onEdit: (
    id: string,
    change: { set: Record<string, string>; unset: string[] },
  ) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const params = type?.params ?? [];
  const change = paramsChange(params, connection.params, draft);
  const changed = Object.keys(change.set).length + change.unset.length > 0;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid={`connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          {connection.name}{' '}
          <span className="font-normal text-muted-foreground">{connection.kind}</span>
        </h3>
        <Badge variant="outline">
          {connection.project === null
            ? t('integrations.scope.global')
            : t('integrations.scope.project', { project: connection.project })}
        </Badge>
        <Badge variant={connection.enabled ? 'ok' : 'mute'}>
          {connection.enabled ? t('integrations.enabled') : t('integrations.disabled')}
        </Badge>
        <ChannelBadge channel={channel} />
        <code className="ml-auto text-xs text-muted-foreground">{connection.id}</code>
      </div>
      {channel?.error ? <p className="text-xs text-status-err">{channel.error}</p> : null}
      <SecretList connection={connection} />
      {params.length === 0 ? null : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onEdit(connection.id, change).then((done) => done && setDraft({}));
          }}
        >
          <div className="flex flex-wrap gap-3">
            {params.map((param) => (
              <ParamField
                key={param.name}
                param={param}
                value={draft[param.name] ?? connection.params[param.name] ?? ''}
                onChange={(value) => setDraft({ ...draft, [param.name]: value })}
              />
            ))}
          </div>
          <div>
            <Button type="submit" size="sm" disabled={!changed}>
              {t('integrations.params.save')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
