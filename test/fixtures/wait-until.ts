/**
 * Polls `check` every 25 ms until it holds; fails after `timeoutMs`, well inside the test
 * timeout, so a stuck wait reports what it waited for instead of timing the test out.
 */
export async function waitUntil(
  what: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Polls `read` every 25 ms until it gives a value; the value is returned. */
export async function waitValue<T>(
  what: string,
  read: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  let value: T | null | undefined;
  await waitUntil(
    what,
    async () => {
      value = await read();
      return value !== null && value !== undefined;
    },
    timeoutMs,
  );
  return value as T;
}
