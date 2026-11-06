// Radix, cmdk and the media hooks expect browser APIs that jsdom lacks.
if (typeof window !== 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.ResizeObserver ??= ResizeObserverStub;
  globalThis.ResizeObserver ??= ResizeObserverStub;

  window.matchMedia ??= ((query: string) => ({
    // A desktop window by default; tests of narrow layouts replace `window.matchMedia`.
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  const proto = window.Element.prototype;
  proto.scrollIntoView ??= () => {};
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
}

// Every test starts in English with nothing chosen: tests of other languages set them up themselves.
if (typeof window !== 'undefined') {
  // `findBy…` and `waitFor` give up after one second by default; the suite often runs next to other
  // test runs, and a loaded machine renders slower than that. Passing tests do not wait longer.
  // The pages the application loads on demand: the first import of each is transformed by Vite
  // and costs hundreds of milliseconds, so it is paid here and not by the first test that opens one.
  // The pages that draw the pipeline graph are not loaded here: a test file may replace the graph.
  await Promise.all([
    import('../src/components/NewTaskDialog.tsx'),
    import('../src/components/QueuePage.tsx'),
    import('../src/components/SpecialistsPage.tsx'),
    import('../src/components/settings/SettingsPage.tsx'),
  ]);
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5_000 });
  const { beforeEach, afterEach } = await import('vitest');
  // A field that switches between controlled and uncontrolled is a bug: React and Radix only
  // warn about it, so the warning is turned into a failure of the test that caused it.
  const switched: string[] = [];
  for (const method of ['error', 'warn'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const text = args.map(String).join(' ');
      if (/changing from (un)?controlled/i.test(text)) switched.push(text);
      original(...args);
    };
  }
  afterEach(() => {
    const found = switched.splice(0);
    if (found.length > 0) throw new Error(found.join('\n'));
  });
  const { default: i18next } = await import('i18next');
  await import('../src/i18n/index.ts');
  // Only a file that draws the whole application needs it; the others test small pieces.
  const { readFileSync } = await import('node:fs');
  const { expect } = await import('vitest');
  const file = expect.getState().testPath;
  if (file && /<App[ >]/.test(readFileSync(file, 'utf8'))) {
    await (await import('./warm.tsx')).warmUp();
  }
  beforeEach(async () => {
    window.localStorage.removeItem('aip.web.language');
    Object.defineProperty(window.navigator, 'languages', {
      value: ['en-US'],
      configurable: true,
    });
    await i18next.changeLanguage('en');
    document.documentElement.lang = 'en';
  });
}

export {};
