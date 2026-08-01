/**
 * The movable base note that non-pointer input sources play from. Shared by
 * the computer keyboard (Z/X) and the game controller (LB/RB) so the two
 * never drift into different registers — nothing on screen shows this value,
 * so a silent disagreement between them is impossible to diagnose.
 */
export const MIN_BASE = 24; // C1
export const MAX_BASE = 96; // C7

/**
 * The widest span any input source reaches above the base: the computer
 * keyboard's two rows, an octave and a half.
 */
export const BASE_SPAN_SEMITONES = 17;

export class BaseOctave {
  private value = 60; // C4
  private readonly listeners = new Set<(midi: number) => void>();

  get(): number {
    return this.value;
  }

  /** Moves a full octave, clamped to the playable base range. */
  shift(direction: 1 | -1): number {
    return this.set(this.value + direction * 12);
  }

  set(midi: number): number {
    const next = Math.min(MAX_BASE, Math.max(MIN_BASE, midi));
    if (next === this.value) return next;
    this.value = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  /**
   * Fires when the base moves. The keyboard uses this to decode the sample
   * roots the new register needs — off-screen notes are otherwise silent.
   */
  subscribe(listener: (midi: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
