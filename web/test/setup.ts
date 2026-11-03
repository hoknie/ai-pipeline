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
  const { configure } = await import('@testing-library/react');
  configure({ asyncUtilTimeout: 5_000 });
  const { beforeEach } = await import('vitest');
  const { default: i18next } = await import('i18next');
  await import('../src/i18n/index.ts');
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
