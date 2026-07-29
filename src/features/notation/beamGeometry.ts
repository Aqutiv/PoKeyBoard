/**
 * Where a beam's line falls across the run that hangs from it.
 *
 * The grouping and the stem direction are settled by `layoutScore`; this is
 * only the line, and it is the same arithmetic on paper and on screen. Both
 * callers work in their own units, so everything here is expressed in staff
 * spaces and scaled by the `gap` passed in — points for the page, pixels for
 * the live score.
 */

/** Ideal stem length in staff spaces. */
export const STEM_LENGTH_G = 3.5;
/** Shortest stem a beam may leave. */
export const MIN_BEAM_STEM_G = 2.8;
/** Maximum rise or fall across a whole run. */
export const BEAM_SLANT_MAX_G = 1;
export const BEAM_THICKNESS_G = 0.5;
/** Centre-to-centre offset of a secondary beam, toward the noteheads. */
export const BEAM_SPACING_G = 0.75;

/**
 * How much further out a stem reaches to carry `beamCount` beams (or flags).
 *
 * Secondary beams stack inward, toward the heads, so two of them fit inside an
 * ordinary stem but a third or fourth would arrive at the notehead. An engraver
 * lengthens the stem instead, by the depth the extra beams take up, and the run
 * keeps a stem worth reading under the innermost one.
 */
export function extraStemG(beamCount: number): number {
  return Math.max(0, beamCount - 2) * BEAM_SPACING_G;
}

export interface BeamSpan {
  /** The beam's y where the first stem meets it, and where the last does. */
  y1: number;
  y2: number;
}

function clampTo(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * `xs` are the stem positions in order and `anchors` the head each stem grows
 * away from, both in the caller's units.
 *
 * The run tilts with its outer notes so the beam follows the shape of the
 * phrase, clamped so a wide leap never turns it into a ramp. It is then shifted
 * bodily outward until even the shortest stem under it is still worth calling a
 * stem — which is why the line can end up further out than any one note asked
 * for.
 */
export function beamSpanFor(
  xs: readonly number[],
  anchors: readonly number[],
  stemDown: boolean,
  gap: number,
  beamCount = 1,
): BeamSpan {
  const dir = stemDown ? 1 : -1;
  const extra = extraStemG(beamCount) * gap;
  const first = anchors[0] as number;
  const last = anchors[anchors.length - 1] as number;
  const tipFirst = first + dir * (STEM_LENGTH_G * gap + extra);
  const slant = clampTo(last - first, BEAM_SLANT_MAX_G * gap);

  const x1 = xs[0] as number;
  const x2 = xs[xs.length - 1] as number;
  const spread = x2 - x1;

  let shift = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const lineY = spread === 0 ? tipFirst : tipFirst + (((xs[i] as number) - x1) / spread) * slant;
    const required = (anchors[i] as number) + dir * (MIN_BEAM_STEM_G * gap + extra);
    const violation = dir === 1 ? required - lineY : lineY - required;
    if (violation > shift) shift = violation;
  }
  const y1 = tipFirst + dir * shift;
  return { y1, y2: y1 + slant };
}

/** y of a beam line at some x along it. */
export function beamYAt(span: BeamSpan, x1: number, x2: number, x: number): number {
  if (x2 === x1) return span.y1;
  return span.y1 + ((x - x1) / (x2 - x1)) * (span.y2 - span.y1);
}
