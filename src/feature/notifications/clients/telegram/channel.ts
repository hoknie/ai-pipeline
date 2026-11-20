import type {
  ChatChannelFactoryPort,
  ChannelOptions,
  ChatChannelPort,
  OutboundMessage,
  InboundHandler,
} from '../../ports/index.ts';
import {
  ChannelFailure,
  texts,
  type ChannelStatus,
  type Draw,
  type ExternalRef,
  type InboundInput,
  type InboundResult,
  type Language,
} from '../../types/index.ts';

import { TelegramApi, TelegramError, toFailure, type TelegramApiOptions } from './api.ts';
import { allowedUsers, TELEGRAM_KIND } from './kind.ts';
import { renderMessage } from './render.ts';
import {
  isCommand,
  isPerson,
  isIdCommand,
  parseUpdates,
  personOf,
  shortKeyOfPrompt,
  type TelegramUpdate,
} from './updates.ts';

const SEND_TIMEOUT_MS = 15_000;
/** How long Telegram holds a `getUpdates` call open when there is nothing to tell. */
const POLL_SECONDS = 25;
const POLL_TIMEOUT_MS = (POLL_SECONDS + 15) * 1000;
const MAX_BACKOFF_MS = 60_000;
const CONFLICT_PAUSE_MS = 60_000;
const CONFLICT_HINT =
  'telegram answered 409: the bot has a webhook or another poller; delete the webhook of the bot';

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface TelegramChannelOptions extends ChannelOptions {
  api: TelegramApi;
  language: Language;
}

/** A chat of Telegram: messages by `sendMessage`, answers by `getUpdates` with a long wait. */
export class TelegramChannel implements ChatChannelPort {
  private readonly options: TelegramChannelOptions;

  constructor(options: TelegramChannelOptions) {
    this.options = options;
  }

  private chat(): string {
    const chat = this.options.connection.params.chat_id;
    if (chat === undefined || chat === '') {
      throw new ChannelFailure('chat_id is not set', { permanent: true });
    }
    return chat;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.options.api.call(method, body, { timeoutMs: SEND_TIMEOUT_MS });
    } catch (error) {
      throw toFailure(error);
    }
  }

  /** The core hands over the delivery; a chat draws it and sends the picture. */
  deliver(message: OutboundMessage): Promise<ExternalRef> {
    return this.send(message.draw, message.delivery.shortKey);
  }

  async send(draw: Draw, shortKey: string): Promise<ExternalRef> {
    const chat = this.chat();
    const { text, keyboard } = renderMessage(draw, shortKey, this.options.language);
    const sent = (await this.call('sendMessage', {
      chat_id: Number(chat),
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard.length === 0 ? {} : { reply_markup: { inline_keyboard: keyboard } }),
    })) as { message_id?: number };
    if (typeof sent?.message_id !== 'number') {
      throw new ChannelFailure('telegram sent no message id', { permanent: false });
    }
    return { chat_id: chat, message_id: sent.message_id };
  }

  async update(ref: ExternalRef, draw: Draw, shortKey: string): Promise<void> {
    const { text, keyboard } = renderMessage(draw, shortKey, this.options.language);
    try {
      await this.options.api.call(
        'editMessageText',
        {
          chat_id: Number(ref.chat_id),
          message_id: Number(ref.message_id),
          text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: keyboard },
        },
        { timeoutMs: SEND_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof TelegramError && /message is not modified/i.test(error.message)) return;
      throw toFailure(error);
    }
  }

  async sendText(text: string): Promise<ExternalRef> {
    const chat = this.chat();
    const sent = (await this.call('sendMessage', { chat_id: Number(chat), text })) as {
      message_id?: number;
    };
    return { chat_id: chat, message_id: sent?.message_id ?? 0 };
  }

  async listen(
    handler: InboundHandler,
    signal: AbortSignal,
    report: (status: ChannelStatus) => void,
  ): Promise<void> {
    let failures = 0;
    let listening = false;
    while (!signal.aborted) {
      const cursor = this.options.cursor.get();
      let result: unknown;
      try {
        result = await this.options.api.call(
          'getUpdates',
          {
            timeout: POLL_SECONDS,
            allowed_updates: ['message', 'callback_query'],
            ...(cursor === null ? {} : { offset: Number(cursor) }),
          },
          { timeoutMs: POLL_TIMEOUT_MS, signal },
        );
      } catch (error) {
        if (signal.aborted) return;
        const failure = toFailure(error);
        listening = false;
        if (failure.unauthorized) {
          report({ state: 'error', error: failure.message, unauthorized: true });
          return;
        }
        const conflict = error instanceof TelegramError && error.status === 409;
        report({
          state: 'error',
          error: conflict ? CONFLICT_HINT : failure.message,
          unauthorized: false,
        });
        failures += 1;
        await pause(
          conflict
            ? CONFLICT_PAUSE_MS
            : (failure.retryAfterMs ?? Math.min(1000 * 2 ** failures, MAX_BACKOFF_MS)),
          signal,
        );
        continue;
      }
      failures = 0;
      if (!listening) {
        listening = true;
        report({ state: 'listening' });
      }
      const { updates, last } = parseUpdates(result);
      for (const update of updates) {
        if (signal.aborted) break;
        await this.process(update, handler).catch(() => undefined);
      }
      // The position moves after the whole batch: an update seen twice is claimed once by the core.
      if (last !== null) this.options.cursor.set(String(last + 1));
    }
  }

  private async process(update: TelegramUpdate, handler: InboundHandler): Promise<void> {
    const t = texts(this.options.language);
    const event = String(update.update_id);
    const callback = update.callback_query;
    if (callback !== undefined) {
      const [shortKey, ...rest] = (callback.data ?? '').split(':');
      const chat = callback.message?.chat.id;
      if (chat === undefined || shortKey === undefined || rest.length === 0) {
        await this.quiet('answerCallbackQuery', { callback_query_id: callback.id });
        return;
      }
      this.see(callback.from);
      const result = await handler.handle({
        type: 'action',
        event,
        chat: String(chat),
        user: String(callback.from.id),
        shortKey,
        action: rest.join(':'),
      });
      if (result.kind === 'prompt') {
        await this.quiet('answerCallbackQuery', { callback_query_id: callback.id });
        await this.quiet('sendMessage', {
          chat_id: chat,
          text: `${t.replyPrompt(result.questions)}\n#${result.shortKey}`,
          reply_to_message_id: callback.message?.message_id,
          reply_markup: { force_reply: true, selective: true },
        });
        return;
      }
      await this.quiet('answerCallbackQuery', {
        callback_query_id: callback.id,
        ...resultText(result, t.results),
      });
      return;
    }
    const message = update.message;
    if (message?.text === undefined) return;
    if (isIdCommand(message.text)) {
      this.see(message.from);
      await this.quiet('sendMessage', {
        chat_id: message.chat.id,
        text: t.who(String(message.chat.id), String(message.from?.id ?? '')),
      });
      return;
    }
    if (isCommand(message.text) || message.from === undefined) return;
    const replied = message.reply_to_message;
    if (replied === undefined) return;
    this.see(message.from);
    const input: InboundInput = {
      type: 'text',
      event,
      chat: String(message.chat.id),
      user: String(message.from.id),
      text: message.text,
      target: { shortKey: shortKeyOfPrompt(replied.text), message: String(replied.message_id) },
    };
    const result = await handler.handle(input);
    const answer = resultText(result, t.results).text;
    if (answer !== undefined) {
      await this.quiet('sendMessage', {
        chat_id: message.chat.id,
        text: answer,
        reply_to_message_id: message.message_id,
      });
    }
  }

  /** Tells the core who is writing; a failure of that never stops the handling of the update. */
  private see(from: Parameters<typeof isPerson>[0]): void {
    if (!isPerson(from)) return;
    try {
      this.options.seen?.(personOf(from));
    } catch {
      // the list of recent senders is a convenience
    }
  }

  /** A call whose failure changes nothing: an acknowledgement or a hint. */
  private async quiet(method: string, body: Record<string, unknown>): Promise<void> {
    try {
      await this.options.api.call(method, body, { timeoutMs: SEND_TIMEOUT_MS });
    } catch {
      // the user sees no acknowledgement; the answer itself is already handled
    }
  }
}

function resultText(result: InboundResult, results: Record<string, string>): { text?: string } {
  const text = results[result.kind];
  return text === undefined ? {} : { text };
}

/** The channel kind `telegram`: how its parameters are read and how its adapter is built. */
export function telegramChannelFactory(
  api: Omit<TelegramApiOptions, 'token'>,
): ChatChannelFactoryPort {
  const languageOf = (params: Readonly<Record<string, string>>): Language =>
    params.language === 'ru' ? 'ru' : 'en';
  return {
    kind: TELEGRAM_KIND,
    language: languageOf,
    allows: (params, chat, user) =>
      params.chat_id !== undefined &&
      params.chat_id === chat &&
      allowedUsers(params).includes(user),
    missingForSubscription: (params) =>
      params.chat_id === undefined || params.chat_id === '' ? 'chat_id' : null,
    create: (options) =>
      new TelegramChannel({
        ...options,
        language: languageOf(options.connection.params),
        api: new TelegramApi({ ...api, token: () => options.secret('bot_token') }),
      }),
  };
}
