import { useEffect, useState } from 'react';

/** Reactive matchMedia hook. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Phones (portrait/landscape) – the primary target of this app. */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
/** Phones + tablets (where the left filter column collapses). */
export const useIsCompact = () => useMediaQuery('(max-width: 1023px)');
