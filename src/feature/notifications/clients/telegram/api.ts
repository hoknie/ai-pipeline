import { httpRequest } from '../../../../platform/http/index.ts';
import { ChannelFailure } from '../../types/index.ts';

export interface TelegramApiOptions {
  /** The address of the Bot API, without the trailing slash. */
  base: string;
  /** The token of the bot; read at the moment of a call. */
  token: () => Promise<string | null>;
  /** The proxy of the shared settings, read before every call. */
  proxy: () => string | null;
  /** Extra certificate authority: a private Bot API server and the tests. */
  ca?: string;
}

/** What Telegram answered with an error: the code, the safe description, the pause it asked for. */
export class TelegramError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, description: string, retryAfterSeconds: number | null) {
    super(description);
    this.name = 'TelegramError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const TOKEN_IN_TEXT = /bot?\d{3,}:[\w-]{10,}/gi;

/** The description of Telegram without anything that looks like a token, and not too long. */
export function safeDescription(text: string): string {
  return text.replace(TOKEN_IN_TEXT, '***').slice(0, 200);
}

interface Envelope {
  ok?: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/** Calls of the Bot API over `platform/http`: JSON in, JSON out, errors without the address. */
export class TelegramApi {
  private readonly options: TelegramApiOptions;

  constructor(options: TelegramApiOptions) {
    this.options = options;
  }

  async call(
    method: string,
    body: Record<string, unknown>,
    limits: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<unknown> {
    const token = await this.options.token();
    if (token === null) {
      throw new ChannelFailure('bot_token is not set', { permanent: true, unauthorized: true });
    }
    let response;
    try {
      response = await httpRequest({
        url: `${this.options.base}/bot${token}/${method}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: limits.timeoutMs,
        proxy: this.options.proxy(),
        ...(limits.signal === undefined ? {} : { signal: limits.signal }),
        ...(this.options.ca === undefined ? {} : { ca: this.options.ca }),
      });
    } catch (error) {
      if (limits.signal?.aborted === true) throw error;
      throw new ChannelFailure(safeNetworkText(error), { permanent: false });
    }
    let parsed: Envelope;
    try {
      parsed = JSON.parse(Buffer.from(response.body).toString('utf8')) as Envelope;
    } catch {
      throw new TelegramError(response.status, 'the answer is not JSON', null);
    }
    if (parsed.ok === true && response.status === 200) return parsed.result;
    throw new TelegramError(
      parsed.error_code ?? response.status,
      safeDescription(parsed.description ?? 'unknown error'),
      parsed.parameters?.retry_after ?? null,
    );
  }
}

function safeNetworkText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'http.timeout'
    ? 'telegram did not answer in time'
    : code === 'http.proxy_refused'
      ? 'the proxy refused the connection'
      : 'cannot reach telegram';
}

/** What a failed call means for the core: wait, give up, or the bot token is wrong. */
export function toFailure(error: unknown): ChannelFailure {
  if (error instanceof ChannelFailure) return error;
  if (!(error instanceof TelegramError)) {
    return new ChannelFailure('unexpected channel error', { permanent: false });
  }
  const { status } = error;
  if (status === 401) {
    return new ChannelFailure('unauthorized: the bot token is not valid', {
      permanent: true,
      unauthorized: true,
    });
  }
  if (status === 429) {
    return new ChannelFailure('telegram asked to slow down', {
      permanent: false,
      retryAfterMs: (error.retryAfterSeconds ?? 1) * 1000,
    });
  }
  if (status === 400 || status === 403 || status === 404) {
    return new ChannelFailure(`telegram refused: ${error.message}`, { permanent: true });
  }
  return new ChannelFailure(`telegram error ${status}`, { permanent: false });
}
