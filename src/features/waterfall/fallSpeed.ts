/**
 * How many seconds of music the falling notes show, from the keys to the top
 * of the view: how long a note takes to fall onto its key. Fewer seconds fall
 * faster, and show less ahead in taller bars. This module must stay free of
 * imports: the settings store and its repository take the steps from here.
 */
export const WATERFALL_SECONDS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8] as const;

export type WaterfallSeconds = (typeof WATERFALL_SECONDS)[number];

export const DEFAULT_WATERFALL_SECONDS: WaterfallSeconds = 3;

/** The quickest fall, where `+` stops… */
export const FASTEST_FALL_SECONDS: WaterfallSeconds = WATERFALL_SECONDS[0];
/** …and the slowest, where `−` does. */
export const SLOWEST_FALL_SECONDS: WaterfallSeconds = WATERFALL_SECONDS[
  WATERFALL_SECONDS.length - 1
] as WaterfallSeconds;

/** The step after `current`: a quicker fall when `faster`, held at either end. */
export function stepWaterfallSeconds(current: WaterfallSeconds, faster: boolean): WaterfallSeconds {
  const index = WATERFALL_SECONDS.indexOf(current);
  const next = Math.min(WATERFALL_SECONDS.length - 1, Math.max(0, index + (faster ? -1 : 1)));
  return WATERFALL_SECONDS[next] as WaterfallSeconds;
}
