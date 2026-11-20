import type {
  ChannelFactoryPort,
  ChannelOptions,
  ChatChannelPort,
  InboundHandler,
} from '../../ports/index.ts';
import {
  ChannelFailure,
  texts,
  type ChannelStatus,
  type Draw,
  type ExternalRef,
  type InboundResult,
  type Language,
} from '../../types/index.ts';

import { SlackApi, toFailure, type SlackApiOptions } from './api.ts';
import { renderMessage } from './blocks.ts';
import { actionOf, type SlackEnvelope } from './events.ts';
import { allowedUsers, SLACK_KIND } from './kind.ts';
import { DEFAULT_TIMING, runSocketMode, type SocketTiming } from './socket.ts';

const SEND_TIMEOUT_MS = 15_000;
/** How many envelope ids are remembered to skip a redelivery inside one run of the daemon. */
const SEEN_LIMIT = 500;

type Received = Exclude<SlackEnvelope, { type: 'hello' | 'disconnect' | 'other' }>;

export interface SlackChannelOptions extends ChannelOptions {
  api: SlackApi;
  language: Language;
  proxy: () => string | null;
  ca?: string | undefined;
  timing: SocketTiming;
}

const HISTORY_WARNING = {
  en: 'Warning: the app has no scope channels:history (groups:history for a private channel): replies in threads will not arrive.',
  ru: 'Внимание: у приложения нет scope channels:history (groups:history для приватного канала): ответы в треде не придут.',
};

/** A channel of Slack: messages by `chat.postMessage`, answers by Socket Mode. */
export class SlackChannel implements ChatChannelPort {
  private readonly options: SlackChannelOptions;
  private readonly seen = new Set<string>();

  constructor(options: SlackChannelOptions) {
    this.options = options;
  }

  private channel(): string {
    const channel = this.options.connection.params.channel_id;
    if (channel === undefined || channel === '') {
      throw new ChannelFailure('channel_id is not set', { permanent: true });
    }
    return channel;
  }

  private async call(method: string, body: Record<string, unknown>) {
    try {
      return await this.options.api.call(method, body, { timeoutMs: SEND_TIMEOUT_MS });
    } catch (error) {
      throw toFailure(error);
    }
  }

  private async post(body: Record<string, unknown>): Promise<ExternalRef> {
    const channel = this.channel();
    const { body: sent } = await this.call('chat.postMessage', { channel, ...body });
    if (typeof sent.ts !== 'string') {
      throw new ChannelFailure('slack sent no message id', { permanent: false });
    }
    return { chat_id: channel, message_id: sent.ts };
  }

  async send(draw: Draw, shortKey: string): Promise<ExternalRef> {
    const { text, blocks } = renderMessage(draw, shortKey, this.options.language);
    return this.post({ text, blocks, unfurl_links: false, unfurl_media: false });
  }

  async update(ref: ExternalRef, draw: Draw, shortKey: string): Promise<void> {
    const { text, blocks } = renderMessage(draw, shortKey, this.options.language);
    await this.call('chat.update', {
      channel: String(ref.chat_id),
      ts: String(ref.message_id),
      text,
      blocks,
    });
  }

  /** The test message: the token is checked first, and a missing scope of history is warned about. */
  async sendText(text: string): Promise<ExternalRef> {
    const { headers } = await this.call('auth.test', {});
    const header = headers['x-oauth-scopes'];
    const scopes = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope !== '');
    const warn =
      scopes.length > 0 &&
      !scopes.includes('channels:history') &&
      !scopes.includes('groups:history');
    return this.post({
      text: warn ? `${text}\n${HISTORY_WARNING[this.options.language]}` : text,
    });
  }

  async listen(
    handler: InboundHandler,
    signal: AbortSignal,
    report: (status: ChannelStatus) => void,
  ): Promise<void> {
    // The envelopes are handled one after another, in the order they came.
    let queue: Promise<void> = Promise.resolve();
    await runSocketMode(
      {
        openUrl: async (aborter) => {
          const { body } = await this.options.api.call(
            'apps.connections.open',
            {},
            { slot: 'app_token', timeoutMs: SEND_TIMEOUT_MS, signal: aborter },
          );
          if (typeof body.url !== 'string' || !/^wss?:\/\//.test(body.url)) {
            throw new ChannelFailure('slack gave no address of the connection', {
              permanent: false,
            });
          }
          return body.url;
        },
        proxy: this.options.proxy,
        ca: this.options.ca,
        timing: this.options.timing,
        receive: (envelope) => {
          queue = queue
            .then(() => this.process(envelope as Received, handler))
            .catch(() => undefined);
        },
      },
      signal,
      report,
    );
    await queue;
  }

  /** The workspace of an event must be the one of the connection, when the connection names one. */
  private ownTeam(team: string | null): boolean {
    const own = this.options.connection.params.team_id;
    return own === undefined || own === '' || team === own;
  }

  private async process(envelope: Received, handler: InboundHandler): Promise<void> {
    if (this.seen.has(envelope.envelopeId)) return;
    this.seen.add(envelope.envelopeId);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!);
    const t = texts(this.options.language);
    if (envelope.type === 'click') {
      const action = actionOf(envelope.actionId, envelope.selected);
      if (action === null || envelope.message === null) return;
      if (!this.ownTeam(envelope.team)) {
        await this.ephemeral(envelope.channel, envelope.user, t.results.forbidden);
        return;
      }
      const result = await handler.handle({
        type: 'action',
        // One press is one event, in whatever envelope Slack delivers it.
        event: `${action.shortKey}:${envelope.actionTs ?? envelope.envelopeId}`,
        chat: envelope.channel,
        user: envelope.user,
        shortKey: action.shortKey,
        action: action.action,
      });
      if (result.kind === 'prompt') {
        await this.quiet('chat.postMessage', {
          channel: envelope.channel,
          thread_ts: envelope.message.thread,
          text: t.replyPrompt(result.questions),
        });
        return;
      }
      if (result.kind === 'forbidden' || result.kind === 'closed') {
        await this.ephemeral(envelope.channel, envelope.user, t.results[result.kind]);
      }
      return;
    }
    if (!this.ownTeam(envelope.team)) return;
    const result = await handler.handle({
      type: 'text',
      event: envelope.envelopeId,
      chat: envelope.channel,
      user: envelope.user,
      text: envelope.text,
      target: { shortKey: null, message: envelope.thread },
    });
    const answer = replyText(result, t.results);
    if (answer !== undefined) {
      await this.ephemeral(envelope.channel, envelope.user, answer, envelope.thread);
    }
  }

  /** A text only this user sees: a refusal, a hint. */
  private ephemeral(channel: string, user: string, text: string, thread?: string): Promise<void> {
    return this.quiet('chat.postEphemeral', {
      channel,
      user,
      text,
      ...(thread === undefined ? {} : { thread_ts: thread }),
    });
  }

  /** A call whose failure changes nothing: a hint. */
  private async quiet(method: string, body: Record<string, unknown>): Promise<void> {
    try {
      await this.options.api.call(method, body, { timeoutMs: SEND_TIMEOUT_MS });
    } catch {
      // the user sees no hint; the answer itself is already handled
    }
  }
}

/** What the user of a thread is told. Strangers in other threads are not answered at all. */
function replyText(result: InboundResult, results: Record<string, string>): string | undefined {
  if (result.kind === 'forbidden' || result.kind === 'ignored' || result.kind === 'prompt') {
    return undefined;
  }
  return results[result.kind];
}

export interface SlackFactoryOptions extends Omit<SlackApiOptions, 'secret'> {
  timing?: Partial<SocketTiming>;
}

/** The channel kind `slack`: how its parameters are read and how its adapter is built. */
export function slackChannelFactory(factory: SlackFactoryOptions): ChannelFactoryPort {
  const languageOf = (params: Readonly<Record<string, string>>): Language =>
    params.language === 'ru' ? 'ru' : 'en';
  return {
    kind: SLACK_KIND,
    language: languageOf,
    allows: (params, chat, user) =>
      params.channel_id !== undefined &&
      params.channel_id === chat &&
      allowedUsers(params).includes(user),
    missingForSubscription: (params) =>
      params.channel_id === undefined || params.channel_id === '' ? 'channel_id' : null,
    create: (options) =>
      new SlackChannel({
        ...options,
        language: languageOf(options.connection.params),
        proxy: factory.proxy,
        ca: factory.ca,
        timing: { ...DEFAULT_TIMING, ...factory.timing },
        api: new SlackApi({
          base: factory.base,
          proxy: factory.proxy,
          ...(factory.ca === undefined ? {} : { ca: factory.ca }),
          secret: (slot) => options.secret(slot),
        }),
      }),
  };
}
