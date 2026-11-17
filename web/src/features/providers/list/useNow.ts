import { useEffect, useState } from 'react';

/** The clock of a countdown: ticks every `intervalMs` and once right after `until`. */
export function useNow(until: number | null, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), intervalMs);
    const wait = until === null ? -1 : until - Date.now();
    const stop = wait >= 0 ? setTimeout(() => setNow(Date.now()), wait + 20) : undefined;
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [until, intervalMs]);
  return now;
}
