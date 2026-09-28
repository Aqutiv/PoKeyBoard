/**
 * How deep a lit key is shaded for the velocity it sounds at.
 *
 * A lit key mixes its hand's colour into the key's own: a soft note is a pale
 * wash, a loud one the full colour. The mix grows in a straight line with
 * velocity, because that is how the score's dynamics are spaced — the marks a
 * score arrives with sit 0.126 apart in velocity, so every step from ppp to
 * fff deepens the key by the same amount. Scaled by loudness instead, forte,
 * fortissimo and fff would land barely a shade apart.
 *
 * The floor is how much colour the softest note keeps: enough that a key the
 * take plays pianissimo still reads plainly as lit — about the shade every lit
 * key had before velocity was shown.
 */

/** The share of the full colour a note at velocity 0 is lit with. */
export const KEY_SHADE_FLOOR = 0.42;

/**
 * The velocity every lit key is shaded at while the shading does not follow
 * touch: the computer keyboard's default, the velocity the pianos' loudness
 * is calibrated at.
 */
export const EVEN_SHADE_VELOCITY = 0.75;

/** The share, 0–1, of a hand's full colour a key lit at `velocity` takes. */
export function keyShadeStrength(velocity: number, followsVelocity: boolean): number {
  // A velocity that is not a number would leave the key's colour undefined,
  // and a key with no colour is no light at all.
  const played = followsVelocity && Number.isFinite(velocity) ? velocity : EVEN_SHADE_VELOCITY;
  const clamped = Math.min(1, Math.max(0, played));
  return KEY_SHADE_FLOOR + (1 - KEY_SHADE_FLOOR) * clamped;
}

/**
 * The same share as a CSS percentage, whole percents only: it goes straight
 * into the key's `color-mix()`, and a key is only rewritten when the string
 * changes.
 */
export function keyShade(velocity: number, followsVelocity: boolean): string {
  return `${Math.round(keyShadeStrength(velocity, followsVelocity) * 100)}%`;
}
