import type { ReactNode } from 'react';
import { useRouter, type Route } from './routerContext';

interface NavItem {
  route: Route;
  label: string;
  icon: ReactNode;
}

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const NAV_ITEMS: NavItem[] = [
  {
    route: 'play',
    label: 'Play',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M8 5v9M12 5v9M16 5v9" />
      </svg>
    ),
  },
  {
    route: 'takes',
    label: 'Takes',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    route: 'settings',
    label: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </svg>
    ),
  },
  {
    route: 'about',
    label: 'About',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...strokeProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8v.01" />
      </svg>
    ),
  },
];

export function AppNav() {
  const { route, navigate } = useRouter();
  return (
    <nav className="app-nav" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.route}
          type="button"
          className="app-nav__item"
          aria-current={route === item.route ? 'page' : undefined}
          onClick={() => navigate(item.route)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
