import { createContext, useContext } from 'react';

export type Route = 'play' | 'library' | 'takes' | 'settings' | 'about';

export const DEFAULT_ROUTE: Route = 'play';
export const ROUTES: readonly Route[] = ['play', 'library', 'takes', 'settings', 'about'];

export function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : DEFAULT_ROUTE;
}

export interface RouterValue {
  route: Route;
  navigate: (route: Route) => void;
}

export const RouterContext = createContext<RouterValue | null>(null);

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside RouterProvider');
  return value;
}
