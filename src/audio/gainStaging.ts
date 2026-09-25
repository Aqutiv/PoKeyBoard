/**
 * The live output stage's levels, in one place for the two things that have to
 * agree on them: the graph that plays through the stage (PianoGraphFactory) and
 * an export kept at its played level, which leaves the stage out and so has to
 * add back the gain the stage gives (`LIVE_MAKEUP_DB` in loudness.ts). Plain
 * numbers and arithmetic, no Web Audio: loudness.ts also runs in the MP3
 * worker, which has none.
 *
 * Live, the piano is turned up by `LIVE_OUTPUT_GAIN_DB`, held by a limiter that
 * chords and runs reach but single notes do not, and then by a soft clipper
 * that only catches what the limiter lets past. Every stage says what it does
 * to the level — the compressor's own makeup gain too, which the Web Audio API
 * adds whether it is wanted or not.
 */

/**
 * What the live stage turns the piano up by, ahead of its limiter. With the
 * limiter's own makeup (`LIMITER_MAKEUP_DB`) it comes to 2.9 dB, the level the
 * app has always played at: the limiter this one replaced sat at −6 dBFS and
 * made up all of that by itself, out of sight.
 */
export const LIVE_OUTPUT_GAIN_DB = 1.76;

/**
 * Where the limiter starts. A single note, however hard it is struck, stays
 * under it at the default volume — on every root of every piano but the two
 * hottest of the Headroom piano's loud layer, which would pass full scale with
 * no limiter at all — so what it holds is chords and runs, not notes.
 */
export const LIMITER_THRESHOLD_DB = -2;

/**
 * None: a limiter wants no knee, and without one the compressor's makeup gain
 * is exactly the spec's formula (`compressorMakeupDb`) rather than depending on
 * how a browser shapes the knee.
 */
export const LIMITER_KNEE_DB = 0;

export const LIMITER_RATIO = 20;

export const LIMITER_ATTACK_S = 0.001;

/**
 * Long enough that a loud passage is held down in smooth dips rather than
 * pumped at every chord; short enough to let go before the next phrase.
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

/** The limiter's own makeup gain: 1.14 dB, where the old one's was 2.9. */
export const LIMITER_MAKEUP_DB = compressorMakeupDb(LIMITER_THRESHOLD_DB, LIMITER_RATIO);
