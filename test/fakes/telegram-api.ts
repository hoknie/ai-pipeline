import { createServer } from 'node:http';

export interface FakeTelegramCall {
  method: string;
  token: string;
  body: Record<string, unknown>;
}

export interface FakeTelegramMessage {
  chat_id: number;
  message_id: number;
  text: string;
  parse_mode?: string;
  reply_markup?: { inline_keyboard?: { text: string; callback_data: string }[][] };
}

export interface FakeTelegramFailure {
  status: number;
  description: string;
  retryAfter?: number;
}

interface Update {
  update_id: number;
  [key: string]: unknown;
}

export interface FakeTelegram {
  /** The base address of the Bot API, `http://127.0.0.1:<port>`. */
  base: string;
  token: string;
  calls: FakeTelegramCall[];
  messages: FakeTelegramMessage[];
  answered: { id: string; text?: string }[];
  /** Consumed one per call of the method: the answer to give instead of the normal one. */
  failures: Map<string, FakeTelegramFailure[]>;
  callsOf(method: string): FakeTelegramCall[];
  /** The updates the next `getUpdates` hands out; `update_id` is numbered by the fake. */
  push(update: Record<string, unknown>): number;
  callback(options: {
    chat: number;
    user: number;
    message: number;
    data: string;
    id?: string;
  }): number;
  text(options: {
    chat: number;
    user: number;
    text: string;
    replyTo?: { message_id: number; text?: string };
  }): number;
  close(): Promise<void>;
}

/** A Bot API on loopback: enough of `getUpdates`, `sendMessage`, `editMessageText` and callbacks. */
export async function startFakeTelegram(
  token = '123456:TEST-token-abcdefghij',
): Promise<FakeTelegram> {
  const calls: FakeTelegramCall[] = [];
  const messages: FakeTelegramMessage[] = [];
  const answered: FakeTelegram['answered'] = [];
  const failures = new Map<string, FakeTelegramFailure[]>();
  const queue: Update[] = [];
  let nextUpdate = 1000;
  let nextMessage = 500;

  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(request.url ?? '');
    const reply = (status: number, payload: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (match === null) return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
    const [, given, method] = match as unknown as [string, string, string];
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<
      string,
      unknown
    >;
    calls.push({ method, token: given, body });
    if (given !== token) {
      return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    }
    const failure = failures.get(method)?.shift();
    if (failure !== undefined) {
      return reply(failure.status, {
        ok: false,
        error_code: failure.status,
        description: failure.description,
        ...(failure.retryAfter === undefined
          ? {}
          : { parameters: { retry_after: failure.retryAfter } }),
      });
    }
    switch (method) {
      case 'getUpdates': {
        const offset = typeof body.offset === 'number' ? body.offset : 0;
        for (let at = queue.length - 1; at >= 0; at -= 1) {
          if (queue[at]!.update_id < offset) queue.splice(at, 1);
        }
        if (queue.length === 0) await new Promise((resolve) => setTimeout(resolve, 30));
        return reply(200, { ok: true, result: queue.filter((one) => one.update_id >= offset) });
      }
      case 'sendMessage': {
        const message: FakeTelegramMessage = {
          chat_id: Number(body.chat_id),
          message_id: nextMessage++,
          text: String(body.text),
          ...(typeof body.parse_mode === 'string' ? { parse_mode: body.parse_mode } : {}),
          ...(body.reply_markup === undefined
            ? {}
            : { reply_markup: body.reply_markup as FakeTelegramMessage['reply_markup'] }),
        };
        messages.push(message);
        return reply(200, {
          ok: true,
          result: { message_id: message.message_id, chat: { id: message.chat_id } },
        });
      }
      case 'editMessageText': {
        const found = messages.find(
          (one) => one.chat_id === Number(body.chat_id) && one.message_id === body.message_id,
        );
        if (found === undefined) {
          return reply(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: message to edit not found',
          });
        }
        const markup = body.reply_markup as FakeTelegramMessage['reply_markup'];
        if (
          found.text === body.text &&
          JSON.stringify(found.reply_markup ?? { inline_keyboard: [] }) === JSON.stringify(markup)
        ) {
          return reply(400, {
            ok: false,
            error_code: 400,
            description: 'Bad Request: message is not modified',
          });
        }
        found.text = String(body.text);
        found.reply_markup = markup;
        return reply(200, { ok: true, result: { message_id: found.message_id } });
      }
      case 'answerCallbackQuery':
        answered.push({
          id: String(body.callback_query_id),
          ...(typeof body.text === 'string' ? { text: body.text } : {}),
        });
        return reply(200, { ok: true, result: true });
      default:
        return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };

  const push: FakeTelegram['push'] = (update) => {
    const id = nextUpdate++;
    queue.push({ update_id: id, ...update });
    return id;
  };
  return {
    base: `http://127.0.0.1:${address.port}`,
    token,
    calls,
    messages,
    answered,
    failures,
    callsOf: (method) => calls.filter((call) => call.method === method),
    push,
    callback: ({ chat, user, message, data, id }) =>
      push({
        callback_query: {
          id: id ?? `cb${nextUpdate}`,
          from: { id: user },
          message: { message_id: message, chat: { id: chat } },
          data,
        },
      }),
    text: ({ chat, user, text, replyTo }) =>
      push({
        message: {
          message_id: nextMessage++,
          chat: { id: chat },
          from: { id: user },
          text,
          ...(replyTo === undefined ? {} : { reply_to_message: replyTo }),
        },
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
