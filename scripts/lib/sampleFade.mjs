/**
 * The fade-out every converted piano sample ends with, and the check that it
 * really does end faded. Kept apart from the build so both can be tested.
 *
 * A sample is its source cut at the register's trim, and the fade runs over
 * the last FADE_S of what is kept: from the trim where the source is longer,
 * and from the source's own end where it is shorter. Scheduled from the trim
 * regardless, a short source's fade would start past its end, or finish past
 * it, and the file would stop dead partway — and a key from F♯6 up has no
 * damper, so a held one plays its sample to the very end.
 */

/** How long the fade-out runs, in seconds. */
export const FADE_S = 1.5;

/** The stretch at a sample's very end that has to have faded, in seconds. */
export const END_WINDOW_S = 0.01;

/**
 * Four steps of 16-bit audio. Faded to nothing, a sample still carries its
 * dither, a step or three either way, so anything this quiet counts as faded
 * however quiet the note was before it.
 */
export const DITHER_FLOOR = 4 / 32768;

/**
 * Where the fade-out starts and how long it runs, in seconds, for a source
 * `sourceS` long cut at `trimS`. A sample shorter than twice FADE_S (none of
 * the packs has one) fades over its second half, so the attack is never
 * touched.
 */
export function fadeOut(trimS, sourceS) {
  const keptS = Math.min(trimS, sourceS);
  const lengthS = Math.min(FADE_S, keptS / 2);
  return { startS: Math.max(0, keptS - lengthS), lengthS };
}

/** The largest magnitude over `[from, to)` frames of every channel. */
function peakOf(channels, from, to) {
  let peak = 0;
  for (const samples of channels) {
    for (let i = Math.max(0, from); i < to; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
  }
  return peak;
}

/**
 * Whether a converted sample ends faded: its last END_WINDOW_S no louder than
 * twice what a linear fade over `fadeS` leaves there (1/75 of where it began,
 * −37.5 dB, for the full 1.5 s), measured against the peak of the stretch the
 * fade covers — or down at the dither floor. Against the whole file's peak
 * instead, a recording that stops on its own short fade, as the bitKlavier
 * sources do after 100 ms, would pass with no fade of ours at all.
 */
export function endsFaded(channels, sampleRate, fadeS) {
  const frames = channels[0]?.length ?? 0;
  const window = Math.max(1, Math.round(END_WINDOW_S * sampleRate));
  const last = peakOf(channels, frames - window, frames);
  const fade = peakOf(channels, frames - Math.round(fadeS * sampleRate), frames);
  const ceiling = (fade * 2 * END_WINDOW_S) / fadeS;
  return { faded: last <= ceiling || last <= DITHER_FLOOR, last, fade, ceiling };
}
