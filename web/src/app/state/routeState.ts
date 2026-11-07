import { useEffect, useRef, useState } from 'react';

import { formatRoute, parseRoute, type Route } from '../../shared/lib/nav/route.ts';

function readRoute(): Route {
  return parseRoute(window.location.hash);
}

function writeRoute(route: Route): void {
  const hash = formatRoute(route);
  if (window.location.hash !== hash)
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

/** The route kept in the address hash, and the last run that was open. */
export function useRouteState() {
  const [route, setRoute] = useState<Route>(readRoute);
  const lastRun = useRef<string | null>(null);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => writeRoute(route), [route]);
  useEffect(() => {
    if (route.view === 'runs' && route.run) lastRun.current = route.run;
  }, [route]);
  return { route, setRoute, lastRun };
}

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
