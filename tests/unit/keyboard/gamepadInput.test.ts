import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseOctave } from '@/features/keyboard/baseOctave';
import { GamepadInput } from '@/features/keyboard/gamepadInput';

const D_UP = 12;
const D_DOWN = 13;
const D_LEFT = 14;
const D_RIGHT = 15;
const A = 0;
const B = 1;
const X = 2;
const Y = 3;
const LB = 4;
const RB = 5;
const LT = 6;
const RT = 7;

interface PadState {
  /** Buttons held fully down. */
  pressed?: number[];
  /** Partial trigger pulls, by button index. */
  analog?: Record<number, number>;
  mapping?: string;
}

let pads: PadState[] = [];
/** The frame callback awaiting the next `frame()`, if the loop is running. */
let pendingFrame: FrameRequestCallback | null = null;
let rafSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;

function buildPad(state: PadState): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, index) => {
    const value = state.analog?.[index] ?? (state.pressed?.includes(index) ? 1 : 0);
    return { pressed: state.pressed?.includes(index) ?? false, touched: false, value };
  });
  return {
    index: 0,
    id: 'test pad',
    connected: true,
    mapping: state.mapping ?? 'standard',
    buttons,
    axes: [0, 0, 0, 0],
    timestamp: 0,
  } as unknown as Gamepad;
}

/** Replaces the connected pads and runs one poll frame. */
function frame(...next: PadState[]) {
  pads = next;
  const callback = pendingFrame;
  pendingFrame = null;
  callback?.(0);
}

/** Connects a pad so the poll loop starts, without playing anything. */
function connect() {
  pads = [{}];
  window.dispatchEvent(new Event('gamepadconnected'));
}

function attachInput(base = new BaseOctave()) {
  const noteOn = vi.fn();
  const noteOff = vi.fn();
  const setSustain = vi.fn();
  const detach = new GamepadInput(base).attach({ noteOn, noteOff, setSustain });
  return { noteOn, noteOff, setSustain, detach, base };
}

function openModal() {
  const dialog = document.createElement('div');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  return dialog;
}

beforeEach(() => {
  pads = [];
  pendingFrame = null;
  rafSpy = vi.fn((callback: FrameRequestCallback) => {
    pendingFrame = callback;
    return 1;
  });
  cancelSpy = vi.fn(() => {
    pendingFrame = null;
  });
  vi.stubGlobal('requestAnimationFrame', rafSpy);
  vi.stubGlobal('cancelAnimationFrame', cancelSpy);
  vi.stubGlobal('navigator', navigator);
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => pads.map(buildPad),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('GamepadInput', () => {
  it('plays one octave, C to C, clockwise from each cluster’s left button', () => {
    const { noteOn, detach } = attachInput();
    connect();
    const expected: Array<[number, number]> = [
      [D_LEFT, 60],
      [D_UP, 62],
      [D_RIGHT, 64],
      [D_DOWN, 65],
      [X, 67],
      [Y, 69],
      [B, 71],
      [A, 72],
    ];
    for (const [button, midi] of expected) {
      frame({ pressed: [button] });
      expect(noteOn).toHaveBeenLastCalledWith(midi, expect.any(Number));
      frame({});
    }
    expect(noteOn).toHaveBeenCalledTimes(expected.length);
    detach();
  });

  it('fires once on the rising edge and releases on the falling edge', () => {
    const { noteOn, noteOff, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT] });
    frame({ pressed: [D_LEFT] });
    frame({ pressed: [D_LEFT] });
    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(noteOff).not.toHaveBeenCalled();
    frame({});
    expect(noteOff).toHaveBeenCalledWith(60);
    detach();
  });

  it('shifts the octave with the bumpers and clamps at the ends', () => {
    const { noteOn, base, detach } = attachInput();
    connect();
    frame({ pressed: [RB] });
    frame({ pressed: [D_LEFT] });
    expect(noteOn).toHaveBeenLastCalledWith(72, expect.any(Number));

    frame({});
    frame({ pressed: [LB] });
    frame({});
    frame({ pressed: [LB] });
    frame({ pressed: [D_LEFT] });
    expect(noteOn).toHaveBeenLastCalledWith(48, expect.any(Number));

    frame({});
    for (let i = 0; i < 6; i += 1) {
      frame({ pressed: [LB] });
      frame({});
    }
    expect(base.get()).toBe(24);

    for (let i = 0; i < 12; i += 1) {
      frame({ pressed: [RB] });
      frame({});
    }
    expect(base.get()).toBe(96);
    detach();
  });

  it('holds sustain across a trigger resting between the thresholds', () => {
    const { setSustain, detach } = attachInput();
    connect();
    frame({ analog: { [LT]: 0.5 } });
    expect(setSustain).toHaveBeenCalledWith(true);

    // Above the release threshold: a resting pull must not chatter the pedal.
    frame({ analog: { [LT]: 0.4 } });
    expect(setSustain).toHaveBeenCalledTimes(1);

    frame({ analog: { [LT]: 0.3 } });
    expect(setSustain).toHaveBeenLastCalledWith(false);
    expect(setSustain).toHaveBeenCalledTimes(2);
    detach();
  });

  it('raises the note a semitone while the right trigger is held', () => {
    const { noteOn, detach } = attachInput();
    connect();
    frame({ analog: { [RT]: 0.9 } });
    frame({ pressed: [D_LEFT], analog: { [RT]: 0.9 } });
    expect(noteOn).toHaveBeenLastCalledWith(61, expect.any(Number));
    detach();
  });

  it('sharps a note when the trigger and the button land in the same frame', () => {
    const { noteOn, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT], analog: { [RT]: 0.9 } });
    expect(noteOn).toHaveBeenLastCalledWith(61, expect.any(Number));
    detach();
  });

  it('releases the pitch it actually started, not a recomputed one', () => {
    const { noteOff, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT], analog: { [RT]: 0.9 } });
    // Trigger released mid-hold: the note must still stop at C#4.
    frame({ pressed: [D_LEFT] });
    frame({});
    expect(noteOff).toHaveBeenCalledWith(61);
    detach();
  });

  it('releases the original pitch when the octave shifts mid-hold', () => {
    const { noteOff, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT] });
    frame({ pressed: [D_LEFT, RB] });
    frame({});
    expect(noteOff).toHaveBeenCalledWith(60);
    detach();
  });

  it('releases everything when the last pad disconnects', () => {
    const { noteOff, setSustain, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT], analog: { [LT]: 0.9 } });
    pads = [];
    window.dispatchEvent(new Event('gamepaddisconnected'));
    expect(noteOff).toHaveBeenCalledWith(60);
    expect(setSustain).toHaveBeenLastCalledWith(false);
    detach();
  });

  it('releases everything when the window loses focus', () => {
    const { noteOff, setSustain, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT], analog: { [LT]: 0.9 } });
    window.dispatchEvent(new Event('blur'));
    expect(noteOff).toHaveBeenCalledWith(60);
    expect(setSustain).toHaveBeenLastCalledWith(false);
    detach();
  });

  it('stops polling and releases everything when the tab is hidden', () => {
    const { noteOff, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT] });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(noteOff).toHaveBeenCalledWith(60);
    expect(pendingFrame).toBeNull();
    hidden.mockRestore();
    detach();
  });

  it('stands down while a modal dialog is open', () => {
    const { noteOn, noteOff, detach } = attachInput();
    connect();
    frame({ pressed: [D_LEFT] });
    openModal();
    // A held button has no later "up" event, so it must release right away.
    frame({ pressed: [D_LEFT] });
    expect(noteOff).toHaveBeenCalledWith(60);
    frame({ pressed: [X] });
    expect(noteOn).toHaveBeenCalledTimes(1);
    detach();
  });

  it('ignores pads that do not use the standard mapping', () => {
    const { noteOn, detach } = attachInput();
    pads = [{ mapping: '' }];
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(rafSpy).not.toHaveBeenCalled();
    expect(noteOn).not.toHaveBeenCalled();
    detach();
  });

  it('schedules no frames at all while nothing is connected', () => {
    const { detach } = attachInput();
    expect(rafSpy).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(rafSpy).not.toHaveBeenCalled();
    detach();
  });

  it('stops polling and ignores later connections once detached', () => {
    const { noteOn, detach } = attachInput();
    connect();
    expect(pendingFrame).not.toBeNull();
    detach();
    expect(cancelSpy).toHaveBeenCalled();

    rafSpy.mockClear();
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(rafSpy).not.toHaveBeenCalled();
    expect(noteOn).not.toHaveBeenCalled();
  });
});
