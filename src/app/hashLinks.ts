/**
 * Share links: a take carried whole in the address's fragment, or a Library
 * track named by its id.
 *
 *   #/s/1.<base64url>   a take, in link format 1 (see TAKE_FORMAT.md)
 *   #/lib/<trackId>     a Library track
 *
 * Neither is a route: `parseHash` falls back to Play for both, which is where
 * a link opens. The shell's link intake (`useHashLinkIntake`) reads one when
 * the app starts on it or when one is followed while the app is open, and
 * swaps it for `#/play` before doing anything else.
 *
 * This module is in the entry chunk, so it stays small and imports nothing:
 * the codec that reads a take link's data loads only when there is one.
 */

/** What a link opens. A take link's `version` is 0 when none can be read: a damaged link. */
export type HashLink =
  { kind: 'take'; version: number; data: string } | { kind: 'library'; trackId: string };

const TAKE_PREFIX = '#/s/';
const LIBRARY_PREFIX = '#/lib/';
/** A link-format version: a positive whole number of at most nine digits. */
const VERSION = /^[1-9]\d{0,8}$/;

function decodeTrackId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A broken escape is kept as written; the catalog turns it away.
    return raw;
  }
}

/**
 * The share link a location hash carries, or null for any other hash — the
 * routes among them. A take link whose version cannot be read is still a take
 * link, of version 0, so that it is reported as damaged rather than ignored.
 */
export function parseHashLink(hash: string): HashLink | null {
  if (hash.startsWith(TAKE_PREFIX)) {
    // indexOf and slice, not a regex: the data can be millions of characters.
    const rest = hash.slice(TAKE_PREFIX.length);
    const dot = rest.indexOf('.');
    const versionText = dot < 0 ? '' : rest.slice(0, dot);
    return {
      kind: 'take',
      version: VERSION.test(versionText) ? Number(versionText) : 0,
      data: dot < 0 ? rest : rest.slice(dot + 1),
    };
  }
  if (hash.startsWith(LIBRARY_PREFIX)) {
    return { kind: 'library', trackId: decodeTrackId(hash.slice(LIBRARY_PREFIX.length)) };
  }
  return null;
}

/**
 * The share link inside pasted or dropped text, on any host — or none, which
 * is null. Nothing is fetched to open one, so whose address it is does not
 * matter: the fragment is all there is to it.
 */
export function hashLinkInText(text: string): HashLink | null {
  const trimmed = text.trim();
  const hashAt = trimmed.indexOf('#');
  return hashAt < 0 ? null : parseHashLink(trimmed.slice(hashAt));
}

/** The app's own address, wherever it is deployed, with `hash` after it. */
function appUrl(hash: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${hash}`;
}

/** The link to a take, given the codec's payload (`1.<base64url>`). */
export function takeLinkUrl(payload: string): string {
  return appUrl(`${TAKE_PREFIX}${payload}`);
}

/** The hash naming a Library track, escaped whatever characters its id holds. */
export function libraryLinkHash(trackId: string): string {
  return `${LIBRARY_PREFIX}${encodeURIComponent(trackId)}`;
}

/** The link to a Library track. */
export function libraryLinkUrl(trackId: string): string {
  return appUrl(libraryLinkHash(trackId));
}

/**
 * Swap the link in the address bar for Play, in place. A reload then reopens
 * Play rather than the link, Back never returns to it, and StrictMode's second
 * mount finds nothing left to read. `replaceState` fires no `hashchange`.
 */
export function clearHashLink(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}#/play`);
}
