/**
 * The live output stage's levels, in one place for the two things that have to
 * agree on them: the graph that plays through the stage (PianoGraphFactory) and
 * an export kept at its played level, which leaves the stage out and so has to
 * add back the gain the stage gives (`LIVE_MAKEUP_DB` in loudness.ts). Plain
 * numbers and arithmetic, no Web Audio: loudness.ts also runs in the MP3
 * worker, which has none.
 *
 * Live, the piano is set to `LIVE_OUTPUT_GAIN_DB`, held by a limiter that dense
 * chords and runs reach, and then by a soft clipper that only catches what the
 * limiter lets past. Every stage says what it does to the level — the
 * compressor's own makeup gain too, which the Web Audio API adds whether it is
 * wanted or not.
 */

/**
 * The piano's level ahead of the limiter: a touch down, which the limiter's
 * own makeup (`LIMITER_MAKEUP_DB`) more than makes up, to the 2.9 dB the app
 * has always played at. The limiter this one replaced made up all of that by
 * itself, out of sight.
 */
export const LIVE_OUTPUT_GAIN_DB = -0.52;

/**
 * Where the limiter starts. It is the limiter that has to hold the densest
 * chords, not the soft clipper, and at 20:1 its output still climbs a
 * twentieth of a dB for every dB over: from −6 dBFS, the loudest passages in
 * the library — La Campanella's close, the Ballade's coda — stay under the
 * clipper's knee even played 3 dB hotter. Single notes mostly pass under it:
 * every Salamander root at the default volume, and all but the seven hottest
 * of the Headroom piano's thirty loud ones.
 */
export const LIMITER_THRESHOLD_DB = -6;

/**
 * None: a limiter wants no knee — a softer one, starting lower, measured no
 * better at keeping dense chords off the soft clipper — and without one the
 * compressor's makeup gain is exactly the spec's formula (`compressorMakeupDb`)
 * rather than depending on how a browser shapes the knee.
 */
export const LIMITER_KNEE_DB = 0;

export const LIMITER_RATIO = 20;

export const LIMITER_ATTACK_S = 0.001;

/**
 * Long enough that a loud passage is held down in smooth dips rather than
 * pumped at every chord; short enough to let go before the next phrase. (Any
 * longer and loud passages lose more level than the pumping they save.)
 */
export const LIMITER_RELEASE_S = 0.3;

/**
 * How far a DynamicsCompressorNode delays what passes through it, so that it
 * sees each peak coming. The API does not say: 6 ms is what Chromium measures,
 * and WebKit and Gecko carry the same compressor code. Anything that joins
 * after the limiter is held back as long, to stay in time with the piano.
 */
export const LIMITER_LOOKAHEAD_S = 0.006;

/**
 * The limiter's release when it is made: the warm start. A
 * DynamicsCompressorNode starts out as if it had just caught a peak — it
 * ducks everything and recovers at its release rate, which at 0.3 s takes
 * 0.28 s — and live, those are the first notes of a session: the gesture that
 * starts the audio plays one. Born with a 1 ms release it is back within 1 dB
 * in 25 ms and 0.1 dB in 90 ms. It cannot do better than that, however fast
 * the release: its own peak detector takes as long (Chromium, at 44.1 and
 * 48 kHz alike).
 */
export const LIMITER_WARMUP_RELEASE_S = 0.001;

/**
 * How long the release takes to ease, exponentially, from the warm-up value
 * to its own, on the audio clock, which stands still until the context first
 * runs. The piano keeps its one way through the limiter throughout; only how
 * fast the limiter lets go changes.
 *
 * What that buys, and what it costs, measured against the same sound struck
 * on a limiter long settled:
 * - a quiet first note is within 1–1.75 dB over its first 50 ms and 1.1 dB
 *   over 250 ms — the fastest-decaying, highest notes the most — where it used
 *   to be 11–13 dB and 2–8.5 dB down;
 * - a loud first chord bends a handful of samples at the soft clipper in its
 *   first 25 ms — 5 on La Campanella's loudest — because a release this fast
 *   lets go between a dense chord's peaks and catches the next a moment late;
 *   from 100 ms on it is held within 0.15 dB of any other chord.
 * The shorter this is, the less of the second; the longer, the more of the
 * first note's dip is gone. A first sound held back until the limiter had
 * settled would avoid both, at the cost of starting it late.
 */
export const LIMITER_WARMUP_S = 0.04;

/**
 * The gain a DynamicsCompressorNode gives everything it passes, whatever its
 * level, on top of its compression: the Web Audio spec has it run a full-scale
 * input through its compression curve and make up the gain that loses, to the
 * power 0.6. With no knee the curve takes 0 dBFS to the threshold plus 1/ratio
 * of the rest of the way up, so this is exact.
 */
export function compressorMakeupDb(thresholdDb: number, ratio: number): number {
  const fullRangeDb = thresholdDb - thresholdDb / ratio;
  return -0.6 * fullRangeDb;
}

/**
 * The limiter's own makeup gain: 3.42 dB, a little more than the 2.9 of the
 * soft-kneed limiter this one replaced, and now counted.
 */
export const LIMITER_MAKEUP_DB = compressorMakeupDb(LIMITER_THRESHOLD_DB, LIMITER_RATIO);
