import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerKeyboardInput } from '@/features/keyboard/computerKeyboard';
import { accentVelocity } from '@/features/keyboard/velocityResponse';

let detach: (() => void) | null = null;

function attachInput(velocity: number) {
  const noteOn = vi.fn();
  const noteOff = vi.fn();
  const input = new ComputerKeyboardInput();
  input.setVelocity(velocity);
  detach = input.attach({ noteOn, noteOff, setSustain: vi.fn() });
  return { noteOn, noteOff };
}

function keyDown(code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true, ...init }));
}

function keyUp(code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, ...init }));
}

afterEach(() => {
  detach?.();
  detach = null;
});

describe('accenting a computer-keyboard note with Shift', () => {
  it('plays a note struck with Shift held at the accent velocity', () => {
    const { noteOn } = attachInput(0.75);

    keyDown('KeyA');
    keyUp('KeyA');
    keyDown('KeyA', { shiftKey: true });

    expect(noteOn.mock.calls).toEqual([
      [60, 0.75],
      [60, accentVelocity(0.75)],
    ]);
  });

  it('accents from whatever the fixed velocity is, up to full', () => {
    const { noteOn } = attachInput(0.9);

    keyDown('KeyD', { shiftKey: true });

    expect(noteOn).toHaveBeenCalledWith(64, 1);
  });

  it('still shifts the octave with Shift held', () => {
    const { noteOn } = attachInput(0.75);

    keyDown('KeyX', { shiftKey: true });
    keyDown('KeyA', { shiftKey: true });
    keyUp('KeyA', { shiftKey: true });
    keyDown('KeyZ', { shiftKey: true });
    keyDown('KeyZ', { shiftKey: true });
    keyDown('KeyA', { shiftKey: true });

    expect(noteOn.mock.calls).toEqual([
      [72, accentVelocity(0.75)],
      [48, accentVelocity(0.75)],
    ]);
  });

  it('releases an accented note whether or not Shift is still down', () => {
    const { noteOff } = attachInput(0.75);

    keyDown('KeyA', { shiftKey: true });
    keyUp('KeyA');

    expect(noteOff).toHaveBeenCalledWith(60);
  });

  it('accents only the notes struck while Shift is down', () => {
    const { noteOn } = attachInput(0.6);

    keyDown('KeyA', { shiftKey: true });
    keyDown('KeyD');

    expect(noteOn.mock.calls).toEqual([
      [60, accentVelocity(0.6)],
      [64, 0.6],
    ]);
  });
});
