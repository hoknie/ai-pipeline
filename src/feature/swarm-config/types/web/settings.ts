export const WEB_AUTH_MODES = ['token', 'none'] as const;

export type WebAuth = (typeof WEB_AUTH_MODES)[number];

/** Addresses the web panel may listen on: loopback only. */
export const WEB_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

export type WebHost = (typeof WEB_HOSTS)[number];

export const DEFAULT_WEB_PORT = 7341;

export interface WebSettings {
  /** The daemon starts the web panel together with itself. */
  autostart: boolean;
  auth: WebAuth;
  port: number;
  host: WebHost;
  /** Where the owner opens the panel from outside, without a trailing slash; used for links in notifications only. */
  publicUrl: string | null;
}

export function defaultWeb(): WebSettings {
  return {
    autostart: true,
    auth: 'token',
    port: DEFAULT_WEB_PORT,
    host: '127.0.0.1',
    publicUrl: null,
  };
}
