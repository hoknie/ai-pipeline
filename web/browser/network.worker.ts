// This deliberately has no API overrides: it tests the browser's actual Worker response CSP.
const scope = self;
scope.onmessage = async (event: MessageEvent<string>) => {
  const url = event.data;
  const results: Record<string, string> = {};
  const violations: string[] = [];
  scope.addEventListener('securitypolicyviolation', (event) => {
    violations.push(event.violatedDirective);
  });
  async function attempt(name: string, run: () => unknown) {
    try {
      await run();
      results[name] = 'allowed';
    } catch {
      results[name] = 'blocked';
    }
  }
  function connection(create: () => EventTarget) {
    return new Promise((resolve, reject) => {
      const target = create();
      target.addEventListener('error', () => reject(new Error('Blocked connection')));
      target.addEventListener('open', resolve);
      target.addEventListener('message', resolve);
    });
  }
  await attempt('fetch', () => fetch(url));
  await attempt('xhr', () => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, false);
    xhr.send('private-diagram-marker');
  });
  await attempt('websocket', () => connection(() => new WebSocket(url.replace('http:', 'ws:'))));
  await attempt('eventsource', () => connection(() => new EventSource(url)));
  await attempt('worker', () => connection(() => new Worker(url)));
  await attempt('sharedworker', () => connection(() => new SharedWorker(url)));
  await attempt('importScripts', () => Reflect.get(scope, 'importScripts')(url));
  await attempt('import', () => import(/* @vite-ignore */ url));
  await attempt('eval', () => Function('return 1')());
  // These Window-only channels cannot navigate or send anything from a Worker.
  results.document = typeof document;
  results.beacon = typeof scope.navigator.sendBeacon;
  results.webrtc = typeof RTCPeerConnection;
  setTimeout(() => scope.postMessage({ results, violations }), 0);
};
