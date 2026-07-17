export interface PointerTrackerCallbacks {
  noteOn(midi: number, velocity: number, pointerId: number): void;
  noteOff(midi: number, pointerId: number): void;
}

/**
 * Tracks every active pointer independently so multi-touch chords and
 * glissando work: each pointer holds at most one sounding key, note-off
 * fires when it leaves a key or lifts, and cancel paths always clean up.
 * Pure logic — the component feeds it hit-tested keys.
 */
export class KeyboardPointerTracker {
  private readonly held = new Map<number, number>();
  private readonly callbacks: PointerTrackerCallbacks;

  constructor(callbacks: PointerTrackerCallbacks) {
    this.callbacks = callbacks;
  }

  down(pointerId: number, midi: number | null, velocity: number): void {
    if (this.held.has(pointerId)) this.up(pointerId);
    if (midi === null) return;
    this.held.set(pointerId, midi);
    this.callbacks.noteOn(midi, velocity, pointerId);
  }

  move(pointerId: number, midi: number | null, velocity: number): void {
    const current = this.held.get(pointerId);
    if (current === undefined) return; // pointer isn't playing (not downed on a key)
    if (midi === current) return;
    this.held.delete(pointerId);
    this.callbacks.noteOff(current, pointerId);
    if (midi !== null) {
      this.held.set(pointerId, midi);
      this.callbacks.noteOn(midi, velocity, pointerId);
    }
  }

  up(pointerId: number): void {
    const current = this.held.get(pointerId);
    if (current === undefined) return;
    this.held.delete(pointerId);
    this.callbacks.noteOff(current, pointerId);
  }

  cancel(pointerId: number): void {
    this.up(pointerId);
  }

  releaseAll(): void {
    for (const [pointerId, midi] of [...this.held]) {
      this.held.delete(pointerId);
      this.callbacks.noteOff(midi, pointerId);
    }
  }

  get activePointerCount(): number {
    return this.held.size;
  }

  heldMidiFor(pointerId: number): number | undefined {
    return this.held.get(pointerId);
  }
}
