/**
 * What the screen marks on keys beyond the take, for a light-up keyboard to
 * show the same:
 * - the key bed's own marks: the keys a practice hold or a lesson asks for,
 *   and the wrong keys flashing. Play and Learn each hand theirs to
 *   `PianoKeyboard`, which publishes them here.
 * - a lesson's keyboard picture (`KeyboardDiagram`): the keys it marks, and
 *   the ones it marks second (a quiz's key, a chapter's illustration).
 *
 * One of each is on screen at a time, but a page on its way out can unmount
 * after the next one mounts, so each publisher clears only its own.
 */
export interface ScreenCues {
  readonly targets: ReadonlySet<number>;
  readonly wrong: ReadonlySet<number>;
  readonly pictured: ReadonlySet<number>;
  readonly picturedSecond: ReadonlySet<number>;
}

const NONE: ReadonlySet<number> = new Set();
export const NO_SCREEN_CUES: ScreenCues = {
  targets: NONE,
  wrong: NONE,
  pictured: NONE,
  picturedSecond: NONE,
};

let keyBedOwner: symbol | null = null;
let pictureOwner: symbol | null = null;
let cues: ScreenCues = NO_SCREEN_CUES;
const listeners = new Set<() => void>();

function update(next: Partial<ScreenCues>): void {
  const merged = { ...cues, ...next };
  const same = (Object.keys(merged) as (keyof ScreenCues)[]).every(
    (key) => merged[key] === cues[key],
  );
  if (same) return;
  cues = merged;
  for (const listener of listeners) listener();
}

/** The same keys as `current`, kept so an equal list redrawn by a render changes nothing. */
function keysOf(
  next: Iterable<number> | undefined,
  current: ReadonlySet<number>,
): ReadonlySet<number> {
  const keys = new Set(next ?? []);
  if (keys.size === 0) return NONE;
  if (keys.size === current.size && [...keys].every((midi) => current.has(midi))) return current;
  return keys;
}

export function publishScreenCues(
  from: symbol,
  targets: ReadonlySet<number> | undefined,
  wrong: ReadonlySet<number> | undefined,
): void {
  keyBedOwner = from;
  update({ targets: targets ?? NONE, wrong: wrong ?? NONE });
}

export function clearScreenCues(from: symbol): void {
  if (keyBedOwner !== from) return;
  keyBedOwner = null;
  update({ targets: NONE, wrong: NONE });
}

export function publishPictureMarks(
  from: symbol,
  marked: readonly number[] | undefined,
  second: readonly number[] | undefined,
): void {
  pictureOwner = from;
  update({
    pictured: keysOf(marked, cues.pictured),
    picturedSecond: keysOf(second, cues.picturedSecond),
  });
}

export function clearPictureMarks(from: symbol): void {
  if (pictureOwner !== from) return;
  pictureOwner = null;
  update({ pictured: NONE, picturedSecond: NONE });
}

export function getScreenCues(): ScreenCues {
  return cues;
}

export function subscribeScreenCues(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
