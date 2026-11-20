import { httpRequest } from '../../../../platform/http/index.ts';
import { ChannelFailure } from '../../types/index.ts';

export interface SlackApiOptions {
  /** The address of the Web API, without the trailing slash. */
  base: string;
  /** A secret of the connection (`bot_token`, `app_token`); read at the moment of a call. */
  secret: (slot: 'bot_token' | 'app_token') => Promise<string | null>;
  /** The proxy of the shared settings, read before every call. */
  proxy: () => string | null;
  /** Extra certificate authority: a private gateway and the tests. */
  ca?: string;
}

/** What Slack answered with an error: the HTTP status, the safe error code, the pause it asked for. */
export class SlackError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, retryAfterSeconds: number | null) {
    super(code);
    this.name = 'SlackError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const TOKEN_IN_TEXT = /xox[a-z]-[\w-]+|xapp-[\w-]+/gi;

/** The error code of Slack (`not_in_channel`) and nothing else: a token never gets into a message. */
export function safeCode(text: unknown): string {
  const value = typeof text === 'string' ? text.replace(TOKEN_IN_TEXT, '***') : '';
  return /^[a-z][a-z0-9_]{0,59}$/.test(value) ? value : 'unknown_error';
}

export interface SlackAnswer {
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

/** Calls of the Web API over `platform/http`: JSON in, JSON out, errors without tokens. */
export class SlackApi {
  private readonly options: SlackApiOptions;

  constructor(options: SlackApiOptions) {
    this.options = options;
  }

  async call(
    method: string,
    body: Record<string, unknown>,
    limits: { timeoutMs: number; signal?: AbortSignal; slot?: 'bot_token' | 'app_token' },
  ): Promise<SlackAnswer> {
    const slot = limits.slot ?? 'bot_token';
    const token = await this.options.secret(slot);
    if (token === null) {
      throw new ChannelFailure(`${slot} is not set`, { permanent: true, unauthorized: true });
    }
    let response;
    try {
      response = await httpRequest({
        url: `${this.options.base}/${method}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
        },
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
    const retry = Number(first(response.headers['retry-after']));
    const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : null;
    let parsed: { ok?: boolean; error?: unknown } & Record<string, unknown>;
    try {
      parsed = JSON.parse(Buffer.from(response.body).toString('utf8')) as typeof parsed;
    } catch {
      throw new SlackError(response.status, 'invalid_response', retryAfter);
    }
    if (parsed.ok === true && response.status === 200)
      return { body: parsed, headers: response.headers };
    throw new SlackError(
      response.status,
      response.status === 429 ? 'ratelimited' : safeCode(parsed.error),
      retryAfter,
    );
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeNetworkText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'http.timeout'
    ? 'slack did not answer in time'
    : code === 'http.proxy_refused'
      ? 'the proxy refused the connection'
      : 'cannot reach slack';
}

/** The codes with which Slack says the token of the app is not accepted. */
export const AUTH_ERRORS: readonly string[] = [
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
];

/** Codes that retrying cannot cure. */
const PERMANENT_ERRORS: readonly string[] = [
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'invalid_blocks',
  'invalid_blocks_format',
  'invalid_arguments',
  'invalid_arg_name',
  'msg_too_long',
  'no_text',
  'cant_update_message',
  'message_not_found',
  'missing_scope',
  'restricted_action',
  'access_denied',
];

/** What a failed call means for the core: wait, give up, or the token is wrong. */
export function toFailure(error: unknown): ChannelFailure {
  if (error instanceof ChannelFailure) return error;
  if (!(error instanceof SlackError)) {
    return new ChannelFailure('unexpected channel error', { permanent: false });
  }
  const code = error.message;
  if (AUTH_ERRORS.includes(code)) {
    return new ChannelFailure('unauthorized: the token of the app is not valid', {
      permanent: true,
      unauthorized: true,
    });
  }
  if (error.status === 429 || code === 'ratelimited') {
    return new ChannelFailure('slack asked to slow down', {
      permanent: false,
      retryAfterMs: (error.retryAfterSeconds ?? 1) * 1000,
    });
  }
  if (code === 'not_in_channel') {
    return new ChannelFailure('slack refused: not_in_channel; invite the app to the channel', {
      permanent: true,
    });
  }
  if (PERMANENT_ERRORS.includes(code)) {
    return new ChannelFailure(`slack refused: ${code}`, { permanent: true });
  }
  return new ChannelFailure(
    error.status >= 500 ? `slack error ${error.status}` : `slack refused: ${code}`,
    { permanent: false },
  );
}
