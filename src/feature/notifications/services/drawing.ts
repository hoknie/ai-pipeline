import { loadWebSettings, type ConfigService } from '../../swarm-config/services/index.ts';
import type { OpenChannel } from './channels.ts';
import {
  chatMessage,
  draftsOf,
  type Closure,
  type Delivery,
  type Draft,
  type Draw,
  type NotificationEventKind,
} from '../types/index.ts';

/** The address of the panel for links, or null when the owner set none. */
export function publicUrlOf(config: ConfigService): string | null {
  try {
    return loadWebSettings(config.pathsOf('.')).publicUrl;
  } catch {
    // a wrong `web` section: no links, the messages still go
    return null;
  }
}

/** The message of a delivery as it is now: with the answers collected so far and the closure, if any. */
export function drawOf(
  delivery: Delivery,
  drafts: readonly Draft[],
  closure: Closure | null,
  opened: Pick<OpenChannel, 'connection' | 'language'>,
  publicUrl: string | null,
): Draw {
  return (limits) =>
    chatMessage({
      kind: delivery.kind as NotificationEventKind,
      run: delivery.run,
      data: delivery.payload,
      drafts: draftsOf(delivery.payload.questions?.length ?? 0, drafts),
      closure,
      channel: opened.connection.name,
      language: opened.language,
      publicUrl,
      limits,
    });
}
