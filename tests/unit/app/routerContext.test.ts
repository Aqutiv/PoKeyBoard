import { afterEach, describe, expect, it } from 'vitest';
import { parseHash, ROUTES } from '@/app/routerContext';

function routeFor(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
  return parseHash();
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('parseHash', () => {
  it('reads each route from its hash', () => {
    for (const route of ROUTES) expect(routeFor(`#/${route}`)).toBe(route);
  });

  it('falls back to Play for an empty or unknown hash', () => {
    expect(routeFor('')).toBe('play');
    expect(routeFor('#/nowhere')).toBe('play');
  });

  // A share link arrives on Play: the shell's link intake reads it there and
  // swaps it for #/play, so the router needs no route of its own for either.
  it('opens a take link or a library link on Play', () => {
    expect(routeFor('#/s/1.AbC-_9')).toBe('play');
    expect(routeFor('#/s/')).toBe('play');
    expect(routeFor('#/lib/a-beautiful-day')).toBe('play');
  });
});
