import type {
  WebhookDeliveryView,
  WebhookTestView,
  WebhookView,
} from '../../ipc/contract/index.ts';

import { type Style, plainStyle } from '../style.ts';
import { addedAt, oneLine, table } from '../table.ts';

function stateOf(webhook: WebhookView): string {
  if (webhook.enabled) return 'enabled';
  if (webhook.disabledReason !== null) return `disabled: ${webhook.disabledReason}`;
  return webhook.secret ? 'disabled' : 'disabled (no secret)';
}

/** The webhooks: where they call, for which events, whether they work; the address has no query. */
export function formatWebhooks(
  webhooks: readonly WebhookView[],
  style: Style = plainStyle,
): string {
  if (webhooks.length === 0) return 'No webhooks yet.';
  return table(
    [
      ['ID', 'NAME', 'URL', 'PROJECT', 'EVENTS', 'STATE'],
      ...webhooks.map((one) => [
        style.argument(one.id),
        one.name,
        one.url,
        one.project ?? 'all projects',
        one.events.join(', '),
        stateOf(one),
      ]),
    ],
    style,
    { flex: 2 },
  );
}

/** What to do next with a webhook that was just made. */
export function webhookNextSteps(webhook: WebhookView): string {
  return [
    `Set the signing secret (from stdin, e.g. \`openssl rand -base64 32\`):`,
    `  aip integration secret set ${webhook.id} signing_secret --stdin`,
    `Then turn the webhook on:`,
    `  aip webhook enable ${webhook.id}`,
  ].join('\n');
}

function outcome(status: number | null, error: string | null): string {
  if (status !== null) return String(status);
  return error ?? '-';
}

/** The journal of a webhook, the newest first, with the attempts of every delivery under it. */
export function formatWebhookDeliveries(
  deliveries: readonly WebhookDeliveryView[],
  style: Style = plainStyle,
): string {
  if (deliveries.length === 0) return 'No deliveries yet.';
  return deliveries
    .map((one) => {
      const head = `${style.argument(String(one.id))}  ${addedAt(one.createdAt)}  ${one.type}${
        one.run === '-' ? '' : ` ${one.run}${one.group === null ? '' : `/${one.group}`}`
      }  ${one.state}  ${one.webhookId}${one.error === null || one.state !== 'failed' ? '' : `  ${oneLine(one.error)}`}`;
      const tries = one.attempts.map(
        (attempt) =>
          `    #${attempt.n} ${addedAt(attempt.at)}  ${outcome(attempt.statusCode, attempt.error)}  ${attempt.durationMs} ms`,
      );
      return [head, ...tries].join('\n');
    })
    .join('\n');
}

/** The result of a test call in one line. */
export function formatWebhookTest(result: WebhookTestView): string {
  const what = outcome(result.statusCode, result.error);
  return result.ok
    ? `Test call accepted: ${what} in ${result.durationMs} ms`
    : `Test call failed: ${what} in ${result.durationMs} ms`;
}
