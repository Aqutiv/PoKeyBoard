import { describe, expect, it, vi } from 'vitest';
import { KeyboardPointerTracker } from '@/features/keyboard/pointerTracker';

function makeTracker() {
  const noteOn = vi.fn();
  const noteOff = vi.fn();
  const tracker = new KeyboardPointerTracker({ noteOn, noteOff });
  return { tracker, noteOn, noteOff };
}

describe('KeyboardPointerTracker', () => {
  it('plays a note per pointer for multi-touch chords', () => {
    const { tracker, noteOn } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.down(2, 64, 0.7);
    tracker.down(3, 67, 0.6);
    expect(noteOn).toHaveBeenCalledTimes(3);
    expect(tracker.activePointerCount).toBe(3);
  });

  it('supports glissando: moving to a new key retriggers', () => {
    const { tracker, noteOn, noteOff } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.move(1, 62, 0.8);
    expect(noteOff).toHaveBeenCalledWith(60, 1);
    expect(noteOn).toHaveBeenLastCalledWith(62, 0.8, 1);
    expect(tracker.heldMidiFor(1)).toBe(62);
  });

  it('ignores movement within the same key', () => {
    const { tracker, noteOn, noteOff } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.move(1, 60, 0.9);
    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(noteOff).not.toHaveBeenCalled();
  });

  it('releases when a pointer leaves the keyboard', () => {
    const { tracker, noteOff } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.move(1, null, 0);
    expect(noteOff).toHaveBeenCalledWith(60, 1);
    expect(tracker.activePointerCount).toBe(0);
  });

  it('ignores moves from pointers that never downed on a key', () => {
    const { tracker, noteOn } = makeTracker();
    tracker.move(9, 60, 0.8);
    expect(noteOn).not.toHaveBeenCalled();
  });

  it('cleans up on up and cancel', () => {
    const { tracker, noteOff } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.up(1);
    tracker.down(2, 64, 0.8);
    tracker.cancel(2);
    expect(noteOff).toHaveBeenCalledTimes(2);
    expect(tracker.activePointerCount).toBe(0);
  });

  it('releaseAll clears every held pointer', () => {
    const { tracker, noteOff } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.down(2, 64, 0.8);
    tracker.releaseAll();
    expect(noteOff).toHaveBeenCalledTimes(2);
    expect(tracker.activePointerCount).toBe(0);
  });

  it('double-down on the same pointer releases the first note', () => {
    const { tracker, noteOff } = makeTracker();
    tracker.down(1, 60, 0.8);
    tracker.down(1, 64, 0.8);
    expect(noteOff).toHaveBeenCalledWith(60, 1);
    expect(tracker.heldMidiFor(1)).toBe(64);
  });
});
