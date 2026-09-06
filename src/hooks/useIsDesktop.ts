import { useEffect, useState } from 'react';

// Matches the `.detail-layout` collapse breakpoint in App.css exactly
// (`@media (max-width: 900px)`), so callers can decide where to place a
// single shared child (e.g. RouteMap) that needs to live in different DOM
// positions on desktop vs. mobile rather than just being restyled.
const QUERY = '(min-width: 901px)';

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}
