import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  ChannelStateView,
  ConnectionView,
  IntegrationTypeView,
} from '../../../shared/api/types.ts';
import { Badge } from '../../../shared/ui/feedback/badge.tsx';
import { Button } from '../../../shared/ui/forms/button.tsx';

import { secretCommand } from '../events.ts';
import { kindTitle, secretLabel } from '../kindLabels.ts';
import { CheckStatus } from '../registry/CheckStatus.tsx';
import { CardActions } from './CardActions.tsx';
import { ParamsForm } from './ParamsForm.tsx';

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

/** Copies the command of the CLI that sets a secret; the text stays on the page to be selected. */
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="ml-2"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? t('integrations.actions.copied') : t('integrations.actions.copy')}
    </Button>
  );
}

function SecretList({ connection }: { connection: ConnectionView }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {connection.secrets.map((secret) => (
        <li key={secret.slot} className="flex flex-wrap items-center gap-2">
          <span>{secretLabel(t, connection.kind, secret.slot)}</span>
          <code className="text-xs text-muted-foreground">{secret.slot}</code>
          <Badge variant={secret.present ? 'ok' : 'warn'}>
            {secret.present ? t('integrations.secret.set') : t('integrations.secret.missing')}
          </Badge>
          {secret.present ? null : (
            <span className="text-xs text-muted-foreground">
              {t('integrations.secret.hint')}{' '}
              <code>{secretCommand(connection.id, secret.slot)}</code>
              <CopyButton text={secretCommand(connection.id, secret.slot)} />
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
  onEnabled,
  onRemove,
  onCheck,
}: {
  connection: ConnectionView;
  type: IntegrationTypeView | undefined;
  channel: ChannelStateView | null;
  onEdit: (
    id: string,
    change: { set: Record<string, string>; unset: string[] },
  ) => Promise<boolean>;
  onEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  /** Present for the kinds that can be checked; the outcome comes back in `lastCheck`. */
  onCheck?: (id: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const params = type?.params ?? [];
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-3"
      data-testid={`connection-${connection.id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">
          {connection.name}{' '}
          <span className="font-normal text-muted-foreground">
            {kindTitle(t, connection.kind, type?.title)}
          </span>
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
      <CardActions
        connection={connection}
        onEnabled={onEnabled}
        onRemove={onRemove}
        onCheck={onCheck}
      />
      {onCheck === undefined ? null : <CheckStatus check={connection.lastCheck} />}
      {channel?.error ? <p className="text-xs text-status-err">{channel.error}</p> : null}
      <SecretList connection={connection} />
      <ParamsForm connection={connection} params={params} onEdit={onEdit} />
    </section>
  );
}
