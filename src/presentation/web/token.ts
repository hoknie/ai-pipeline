import { configError } from './errors.ts';

export function assertLoopbackHost(host: string): void {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw configError('the web panel only listens on loopback: use 127.0.0.1, localhost or ::1');
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** The fixed access token from `AIP_WEB_TOKEN`, or undefined when the variable is not set. */
export function webTokenFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.AIP_WEB_TOKEN;
  if (value === undefined || value === '') return undefined;
  if (!TOKEN_PATTERN.test(value))
    throw configError('AIP_WEB_TOKEN must be 16-128 characters of A-Z, a-z, 0-9, - and _');
  return value;
}
