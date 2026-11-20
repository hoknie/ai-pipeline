import { httpFailureCode, httpRequest } from '../../../../platform/http/index.ts';
import type {
  ChannelFactoryPort,
  ChannelOptions,
  OutboundChannelPort,
  OutboundMessage,
} from '../../ports/index.ts';
import {
  ChannelFailure,
  linkOf,
  WEBHOOK_RETRY,
  type AttemptRecord,
  type ExternalRef,
} from '../../types/index.ts';

import { webhookBody } from './payload.ts';
import { WEBHOOK_KIND, WEBHOOK_SECRET_SLOT } from './kind.ts';
import { signedHeaders } from './sign.ts';

/** One attempt, from the connection to the end of the answer. */
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** How much of the answer is read. */
export const RESPONSE_LIMIT = 64 * 1024;
const EXCERPT_CHARS = 1024;

export interface WebhookFactoryOptions {
  /** The proxy of the shared settings, read before every attempt. */
  proxy: () => string | null;
  /** The version put in `User-Agent`. */
  version: string;
  /** Extra certificate authority: a private receiver and the tests. */
  ca?: string;
  timeoutMs?: number;
}

/** The seconds a `Retry-After` header asks for, as milliseconds; null for anything else. */
export function retryAfterMs(value: string | string[] | undefined, now: number): number | null {
  const text = (Array.isArray(value) ? value[0] : value)?.trim();
  if (text === undefined || text === '') return null;
  if (/^\d+$/.test(text)) return Math.min(Number(text), 86_400) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(at - now, 0);
}

const ERROR_TEXT: Record<string, string> = {
  timeout: 'the receiver did not answer in time',
  proxy_refused: 'the proxy refused the connection',
  too_large: 'the answer of the receiver is too large',
  network: 'cannot reach the receiver',
  aborted: 'the request was cancelled',
};

/** Sends the events of the runs to the address of a webhook, signed as Standard Webhooks wants. */
export class WebhookChannel implements OutboundChannelPort {
  private readonly options: ChannelOptions;
  private readonly factory: WebhookFactoryOptions;

  constructor(options: ChannelOptions, factory: WebhookFactoryOptions) {
    this.options = options;
    this.factory = factory;
  }

  async deliver(message: OutboundMessage): Promise<ExternalRef> {
    const { delivery } = message;
    const now = this.options.now ?? Date.now;
    const url = this.options.connection.params.url;
    if (url === undefined) throw new ChannelFailure('url is not set', { permanent: true });
    const secret = await this.options.secret(WEBHOOK_SECRET_SLOT);
    if (secret === null) {
      throw new ChannelFailure('signing_secret is not set', { permanent: true });
    }
    const id = `msg_${delivery.shortKey}`;
    const startedAt = now();
    const body = webhookBody({
      kind: delivery.kind,
      key: delivery.eventKey,
      run: delivery.run,
      data: delivery.payload,
      at: delivery.kind === 'test' ? startedAt : delivery.createdAt,
      url:
        delivery.kind === 'test' ? null : linkOf(message.publicUrl, delivery.run, delivery.group),
    });
    const began = performance.now();
    const record = (attempt: Omit<AttemptRecord, 'startedAt' | 'durationMs'>): void =>
      this.options.record?.(delivery.id, {
        startedAt,
        durationMs: performance.now() - began,
        ...attempt,
      });
    let response;
    try {
      response = await httpRequest({
        url,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': `aip-webhooks/${this.factory.version}`,
          ...signedHeaders(secret, id, Math.floor(startedAt / 1000), body),
        },
        body,
        timeoutMs: this.factory.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
        maxResponseBytes: RESPONSE_LIMIT,
        truncateResponse: true,
        proxy: this.factory.proxy(),
        ...(this.factory.ca === undefined ? {} : { ca: this.factory.ca }),
      });
    } catch (error) {
      const kind = httpFailureCode(error) ?? 'network';
      record({ statusCode: null, errorKind: kind, excerpt: null });
      throw new ChannelFailure(ERROR_TEXT[kind] ?? 'cannot reach the receiver', {
        permanent: false,
      });
    }
    const excerpt = Buffer.from(response.body).toString('utf8').slice(0, EXCERPT_CHARS);
    const { status } = response;
    if (status >= 200 && status < 300) {
      record({ statusCode: status, errorKind: null, excerpt });
      return { webhook_id: id, status };
    }
    record({ statusCode: status, errorKind: errorKindOf(status), excerpt });
    if (status === 410) {
      throw new ChannelFailure('the receiver answered 410 Gone', {
        permanent: true,
        disable: true,
      });
    }
    throw new ChannelFailure(`the receiver answered ${status}`, {
      permanent: false,
      ...(status === 429
        ? { retryAfterMs: retryAfterMs(response.headers['retry-after'], now()) }
        : {}),
    });
  }
}

function errorKindOf(status: number): string {
  if (status === 410) return 'gone';
  if (status === 429) return 'rate_limited';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client_error';
  return 'server_error';
}

/** The channel kind `webhook`: it only sends, with the retries of a webhook. */
export function webhookChannelFactory(options: WebhookFactoryOptions): ChannelFactoryPort {
  return {
    kind: WEBHOOK_KIND,
    language: () => 'en',
    allows: () => false,
    missingForSubscription: (params) =>
      params.url === undefined || params.url === '' ? 'url' : null,
    retry: WEBHOOK_RETRY,
    editsMessages: false,
    create: (channel) => new WebhookChannel(channel, options),
  };
}
