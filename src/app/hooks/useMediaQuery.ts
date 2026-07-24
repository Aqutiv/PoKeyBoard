import { useSyncExternalStore } from 'react';

/**
 * The short-landscape breakpoint that switches the play view into compact
 * mode. Must stay in sync with the CSS media queries in index.css and
 * transport.css.
 */
export const COMPACT_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';

/** Reactively tracks a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
