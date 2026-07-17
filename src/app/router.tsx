import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { parseHash, RouterContext, type Route } from './routerContext';

/**
 * Dependency-free hash router. Hash routes keep the PWA to a single real
 * URL, which makes the offline navigation fallback and subpath deployments
 * trivial.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`;
  }, []);

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}
