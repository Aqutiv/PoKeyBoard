import type { ScoreLayout } from './notationLayout';

/** Design pixels per millisecond at 100%, for music that is not crowded. */
export const BASE_PX_PER_MS = 0.09;

/** The zoom a take may be shown at; its `display.zoom` is held to this. */
export const MIN_DISPLAY_ZOOM = 0.25;
export const MAX_DISPLAY_ZOOM = 4;

/** Each step of the zoom buttons, as a factor. */
const ZOOM_STEP = 1.25;

/**
 * The narrowest space the score leaves between two onsets that follow each
 * other on a staff, in design pixels. A head is about 11.5 wide: any closer
 * and heads touch.
 */
export const MIN_ONSET_GAP_PX = 16;

/** The most the spacing stretches on its own, before the player's zoom. */
const MAX_STRETCH = 3;

/**
 * How widely a take's music is spaced at 100%. Time-proportional, so fast
 * music comes out crowded: at 120 bpm a run of sixteenths is 11 px apart at
 * the base rate, and their heads overlap. The spacing stretches until the
 * take's closest common onsets are `MIN_ONSET_GAP_PX` apart — measured at the
 * tenth percentile, so one grace note or a rolled chord does not stretch
 * everything — and stays at the base rate for music with room to breathe.
 */
export function basePxPerMsFor(layout: ScoreLayout): number {
  const gaps: number[] = [];
  for (const staff of ['treble', 'bass'] as const) {
    let previous: number | null = null;
    for (const chord of layout.chords) {
      if (chord.staff !== staff) continue;
      if (previous !== null && chord.displayStartMs > previous) {
        gaps.push(chord.displayStartMs - previous);
      }
      previous = chord.displayStartMs;
    }
  }
  if (gaps.length < 8) return BASE_PX_PER_MS;
  gaps.sort((a, b) => a - b);
  const close = gaps[Math.floor(gaps.length * 0.1)] as number;
  return Math.min(BASE_PX_PER_MS * MAX_STRETCH, Math.max(BASE_PX_PER_MS, MIN_ONSET_GAP_PX / close));
}

/**
 * `zoom` moved by `steps` of the zoom buttons (fractions for a pinch), held
 * to the allowed range and rounded, so a few steps out and back return to
 * exactly where they began.
 */
export function nextZoom(zoom: number, steps: number): number {
  const next = zoom * ZOOM_STEP ** steps;
  const clamped = Math.min(MAX_DISPLAY_ZOOM, Math.max(MIN_DISPLAY_ZOOM, next));
  return Math.round(clamped * 1000) / 1000;
}
