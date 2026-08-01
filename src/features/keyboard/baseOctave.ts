/**
 * The movable base note that non-pointer input sources play from. Shared by
 * the computer keyboard (Z/X) and the game controller (LB/RB) so the two
 * never drift into different registers — nothing on screen shows this value,
 * so a silent disagreement between them is impossible to diagnose.
 */
export const MIN_BASE = 24; // C1
export const MAX_BASE = 96; // C7

export class BaseOctave {
  private value = 60; // C4

  get(): number {
    return this.value;
  }

  /** Moves a full octave, clamped to the playable base range. */
  shift(direction: 1 | -1): number {
    return this.set(this.value + direction * 12);
  }

  set(midi: number): number {
    this.value = Math.min(MAX_BASE, Math.max(MIN_BASE, midi));
    return this.value;
  }
}
