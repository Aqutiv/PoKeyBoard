/**
 * What the mounted key bed marks beyond the take: the keys a practice hold or
 * a lesson asks for, and the wrong keys flashing. Play and Learn each hand
 * their own to `PianoKeyboard`, which publishes them here for a light-up
 * keyboard to show the same, wherever they came from.
 *
 * One key bed is on screen at a time, but a page on its way out can unmount
 * after the next one mounts, so each publisher clears only its own.
 */
export interface ScreenCues {
  readonly targets: ReadonlySet<number>;
  readonly wrong: ReadonlySet<number>;
}

const NONE: ReadonlySet<number> = new Set();
export const NO_SCREEN_CUES: ScreenCues = { targets: NONE, wrong: NONE };

let owner: symbol | null = null;
let cues: ScreenCues = NO_SCREEN_CUES;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function publishScreenCues(
  from: symbol,
  targets: ReadonlySet<number> | undefined,
  wrong: ReadonlySet<number> | undefined,
): void {
  const next = { targets: targets ?? NONE, wrong: wrong ?? NONE };
  if (owner === from && cues.targets === next.targets && cues.wrong === next.wrong) return;
  owner = from;
  cues = next;
  notify();
}

export function clearScreenCues(from: symbol): void {
  if (owner !== from) return;
  owner = null;
  cues = NO_SCREEN_CUES;
  notify();
}

export function getScreenCues(): ScreenCues {
  return cues;
}

export function subscribeScreenCues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
