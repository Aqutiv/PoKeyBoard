import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputerKeyboardInput } from '@/features/keyboard/computerKeyboard';

function attachInput() {
  const noteOn = vi.fn();
  const noteOff = vi.fn();
  const setSustain = vi.fn();
  const detach = new ComputerKeyboardInput().attach({ noteOn, noteOff, setSustain });
  return { noteOn, noteOff, setSustain, detach };
}

function keyDown(code: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true, ...init }));
}

function keyUp(code: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
}

/** A stand-in for an open export dialog, which renders beside the piano. */
function openModal() {
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  return dialog;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('ComputerKeyboardInput', () => {
  it('holds sustain for as long as Space is down', () => {
    const { setSustain, detach } = attachInput();
    keyDown('Space');
    expect(setSustain).toHaveBeenCalledWith(true);
    keyUp('Space');
    expect(setSustain).toHaveBeenLastCalledWith(false);
    detach();
  });

  it('ignores the auto-repeat while Space is held', () => {
    const { setSustain, detach } = attachInput();
    keyDown('Space');
    keyDown('Space', { repeat: true });
    keyDown('Space', { repeat: true });
    expect(setSustain).toHaveBeenCalledTimes(1);
    detach();
  });

  it('releases the pedal and any held notes when the window loses focus', () => {
    const { noteOff, setSustain, detach } = attachInput();
    keyDown('KeyA');
    keyDown('Space');
    window.dispatchEvent(new Event('blur'));
    expect(noteOff).toHaveBeenCalledWith(60);
    expect(setSustain).toHaveBeenLastCalledWith(false);
    detach();
  });

  it('stands down while a modal dialog is open', () => {
    const { noteOn, setSustain, detach } = attachInput();
    openModal();
    keyDown('Space');
    keyDown('KeyA');
    expect(setSustain).not.toHaveBeenCalled();
    expect(noteOn).not.toHaveBeenCalled();
    detach();
  });

  it('still releases a note held from before the dialog opened', () => {
    const { noteOff, detach } = attachInput();
    keyDown('KeyA');
    openModal();
    keyUp('KeyA');
    expect(noteOff).toHaveBeenCalledWith(60);
    detach();
  });
});
