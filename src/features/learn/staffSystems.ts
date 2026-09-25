import { gutterWidthFor, SCORE_LEAD_IN } from '@/features/notation/scoreRenderer';

/** Room kept clear at a snippet's right edge, after the last note. */
export const SNIPPET_RIGHT_PAD_PX = 16;

/**
 * The narrowest a beat may be drawn before a long line breaks onto another
 * system. A quarter-note head is about 11.5px wide, so this leaves a clear gap
 * between neighbours — the densest line a Beginner chapter writes.
 */
const MIN_PX_PER_BEAT = 20;

/**
 * A phrase this short always stays on one system, drawn exactly as before
 * systems existed: every chapter up to the first melody writes two bars at
 * most, and several tests count one canvas.
 */
const ONE_SYSTEM_MAX_BARS = 2;

/**
 * Four bars to a line at most, as most printed music sets them — and the
 * length of a Beginner phrase, so a two-phrase tune reads as question above
 * answer rather than as one long stream across a wide screen.
 */
const MAX_BARS_PER_SYSTEM = 4;

/**
 * How many bars go on each system at this width: the most that keep a beat at
 * least `MIN_PX_PER_BEAT` wide, up to four, rounded down to a divisor of the
 * line so every system carries the same number of bars — an eight-bar tune
 * breaks 4+4 or 2+2+2+2, never 3+3+2, and a phrase never ends partway along a
 * system.
 */
export function barsPerSystemFor(barCount: number, beatsPerBar: number, widthPx: number): number {
  if (barCount <= ONE_SYSTEM_MAX_BARS) return barCount;
  const usablePx = widthPx - gutterWidthFor(0) - SCORE_LEAD_IN - SNIPPET_RIGHT_PAD_PX;
  const fit = Math.min(
    MAX_BARS_PER_SYSTEM,
    Math.max(1, Math.floor(usablePx / (beatsPerBar * MIN_PX_PER_BEAT))),
  );
  for (let bars = Math.min(fit, barCount); bars > 1; bars -= 1) {
    if (barCount % bars === 0) return bars;
  }
  return 1;
}
