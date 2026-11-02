/** Makes `window.matchMedia` answer `min-width` queries as a window of the given width; returns a restore function. */
export function setWindowWidth(width: number): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}
