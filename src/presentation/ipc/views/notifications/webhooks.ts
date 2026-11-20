import { displayUrl } from '../../../../feature/notifications/types/index.ts';
import type { WebhookView } from '../../contract/index.ts';

/** A webhook as the clients see it: the address once more without anything but scheme, host, port and path. */
export function webhookView(view: WebhookView): WebhookView {
  return { ...view, url: displayUrl(view.url) };
}
