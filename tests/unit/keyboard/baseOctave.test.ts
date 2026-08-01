import { describe, expect, it, vi } from 'vitest';
import { BaseOctave, MAX_BASE, MIN_BASE } from '@/features/keyboard/baseOctave';
import { ComputerKeyboardInput } from '@/features/keyboard/computerKeyboard';

describe('BaseOctave', () => {
  it('starts at C4 and moves a full octave at a time', () => {
    const base = new BaseOctave();
    expect(base.get()).toBe(60);
    expect(base.shift(1)).toBe(72);
    expect(base.shift(-1)).toBe(60);
  });

  it('announces every move so the new register can be decoded', () => {
    const base = new BaseOctave();
    const seen: number[] = [];
    const unsubscribe = base.subscribe((midi) => seen.push(midi));

    base.shift(1);
    base.shift(-1);
    expect(seen).toEqual([72, 60]);

    // A shift the clamp swallows changes nothing, so it says nothing.
    base.set(MIN_BASE);
    base.shift(-1);
    expect(seen).toEqual([72, 60, MIN_BASE]);

    unsubscribe();
    base.shift(1);
    expect(seen).toEqual([72, 60, MIN_BASE]);
  });

  it('clamps to the playable base range', () => {
    const base = new BaseOctave();
    for (let i = 0; i < 10; i += 1) base.shift(-1);
    expect(base.get()).toBe(MIN_BASE);
    for (let i = 0; i < 20; i += 1) base.shift(1);
    expect(base.get()).toBe(MAX_BASE);
  });

  it('carries the computer keyboard’s Z/X shift onto the shared instance', () => {
    const base = new BaseOctave();
    const noteOn = vi.fn();
    const detach = new ComputerKeyboardInput(base).attach({
      noteOn,
      noteOff: vi.fn(),
      setSustain: vi.fn(),
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX' }));
    // Anything else holding this instance — the controller — now plays from C5.
    expect(base.get()).toBe(72);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    expect(noteOn).toHaveBeenCalledWith(72, expect.any(Number));

    // ...and a shift made elsewhere is visible to the keyboard.
    base.shift(-1);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(noteOn).toHaveBeenLastCalledWith(62, expect.any(Number));
    detach();
  });
});
