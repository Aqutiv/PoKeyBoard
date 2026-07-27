import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { scrubController } from '@/features/notation/scrubController';
import { transportController } from '@/features/transport/transportController';
import { parseHash, RouterContext, type Route } from './routerContext';

/**
 * Playback intentionally keeps running across tab changes, so this only ends
 * the interactions that belong to the page being left. Notes are not flushed:
 * the scheduler has already queued the next look-ahead window.
 */
function settleTransportForRouteChange(): void {
  if (scrubController.isActive) scrubController.end();
  transportController.handleNavigation();
}

/**
 * Dependency-free hash router. Hash routes keep the PWA to a single real
 * URL, which makes the offline navigation fallback and subpath deployments
 * trivial.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => {
      settleTransportForRouteChange();
      setRoute(parseHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    if (next === parseHash()) return;
    settleTransportForRouteChange();
    window.location.hash = `/${next}`;
  }, []);

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}
