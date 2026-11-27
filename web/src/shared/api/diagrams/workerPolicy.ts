const checked = new Map<string, Promise<void>>();

/** Never send a task to a Worker served without its isolation policy (including dev servers). */
export function verifyDiagramWorker(url: string): Promise<void> {
  let check = checked.get(url);
  if (!check) {
    check = fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    }).then(async (response) => {
      const policy = response.headers.get('content-security-policy') ?? '';
      if (
        !response.ok ||
        !/(?:^|;)\s*connect-src\s+'none'\s*(?:;|$)/.test(policy) ||
        !/(?:^|;)\s*script-src\s+'wasm-unsafe-eval'\s*(?:;|$)/.test(policy) ||
        !/(?:^|;)\s*default-src\s+'none'\s*(?:;|$)/.test(policy) ||
        !/(?:^|;)\s*worker-src\s+'none'\s*(?:;|$)/.test(policy)
      ) {
        await response.body?.cancel();
        throw new Error('Diagram worker isolation policy is missing');
      }
      // Complete the immutable asset response so the browser may reuse it for the Worker.
      await response.arrayBuffer();
    });
    checked.set(url, check);
    void check.catch(() => {
      checked.delete(url);
    });
  }
  return check;
}
