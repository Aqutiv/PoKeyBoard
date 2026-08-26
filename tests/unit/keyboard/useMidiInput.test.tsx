import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { __resetForTests as resetRange } from '@/audio/playableRange';
import { __resetForTests as resetAccess, getSnapshot } from '@/features/keyboard/midiAccess';
import { registerMidiKeyboard, useMidiInput } from '@/features/keyboard/useMidiInput';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

const NOTE_ON = 0x90;
const CC = 0xb0;

class FakePort extends EventTarget {
  id: string;
  name: string;

  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }
}

let ports: Map<string, FakePort>;
let access: EventTarget & { inputs: Map<string, FakePort> };
let port: FakePort;

function send(...bytes: number[]) {
  port.dispatchEvent(new MessageEvent('midimessage', { data: Uint8Array.from(bytes) }));
}

/** Mounts the hook the way the app shell does — with no keyboard on screen. */
function Harness() {
  useMidiInput();
  return null;
}

async function mountShell() {
  const view = render(<Harness />);
  await vi.waitFor(() => expect(getSnapshot().kind).toBe('ready'));
  return view;
}

beforeEach(() => {
  resetAccess();
  resetRange();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS, midiInput: true });
  ports = new Map();
  port = new FakePort('a', 'Keystation Mini 32 MK3');
  ports.set(port.id, port);
  access = Object.assign(new EventTarget(), { inputs: ports });
  Object.defineProperty(navigator, 'requestMIDIAccess', {
    configurable: true,
    value: () => Promise.resolve(access),
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: 'granted' }) },
  });
  vi.spyOn(audioEngine, 'ensurePlayableRange').mockResolvedValue(undefined);
});

afterEach(() => {
  // No `globals: true`, so RTL's auto-cleanup is not registered — without
  // this every mounted shell stays attached and re-handles the next test's
  // messages.
  cleanup();
  vi.restoreAllMocks();
  resetAccess();
  resetRange();
  useSettingsStore.setState(SETTINGS_DEFAULTS);
});

describe('useMidiInput', () => {
  // The app shell owns the device, so the piano answers on Settings, Takes
  // and Library too — not only where the key bed happens to be mounted.
  it('plays with no keyboard on screen', async () => {
    const noteOn = vi.spyOn(audioEngine, 'noteOn').mockReturnValue(true);
    const noteOff = vi.spyOn(audioEngine, 'noteOff').mockReturnValue(undefined);
    await mountShell();

    send(NOTE_ON, 60, 100);
    expect(noteOn).toHaveBeenCalledWith(60, 100 / 127, 'midi');

    send(NOTE_ON, 60, 0);
    expect(noteOff).toHaveBeenCalledWith(60, 'midi');
  });

  it('loads the register an off-screen device reaches', async () => {
    await mountShell();

    send(NOTE_ON, 36, 100);

    // An octave of lookahead either side of what arrived.
    expect(audioEngine.ensurePlayableRange).toHaveBeenLastCalledWith(24, 48);
  });

  // What makes the Piano volume slider track the controller's knob live.
  it('drives the master volume from CC7', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    await mountShell();

    send(CC, 7, 64);

    expect(useSettingsStore.getState().masterVolume).toBeCloseTo(64 / 127);
    raf.mockRestore();
  });

  it('sends reveal and bend to a mounted keyboard, and shrugs without one', async () => {
    await mountShell();

    // No keyboard registered: a bend must not throw.
    expect(() => send(0xe0, 0, 20)).not.toThrow();

    const reveal = vi.fn();
    const shiftOctave = vi.fn();
    const unregister = registerMidiKeyboard({ reveal, shiftOctave });

    send(NOTE_ON, 36, 100);
    expect(reveal).toHaveBeenCalledWith(36);

    unregister();
    reveal.mockClear();
    send(NOTE_ON, 40, 100);
    expect(reveal).not.toHaveBeenCalled();
  });

  /**
   * The engine drops a note with no decoded sample outright — it is not even
   * recorded — so the first key pressed in a register the app has never
   * visited would be swallowed entirely.
   */
  it('sounds a note whose samples were still loading', async () => {
    let release!: () => void;
    vi.spyOn(audioEngine, 'ensurePlayableRange').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const noteOn = vi.spyOn(audioEngine, 'noteOn').mockReturnValue(false);
    await mountShell();

    send(NOTE_ON, 30, 100);
    expect(noteOn).toHaveBeenCalledTimes(1);

    // Samples land while the key is still held.
    noteOn.mockReturnValue(true);
    release();
    await vi.waitFor(() => expect(noteOn).toHaveBeenCalledTimes(2));
    expect(noteOn).toHaveBeenLastCalledWith(30, 100 / 127, 'midi');
  });

  it('does not sound a late note whose key was already released', async () => {
    let release!: () => void;
    vi.spyOn(audioEngine, 'ensurePlayableRange').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const noteOn = vi.spyOn(audioEngine, 'noteOn').mockReturnValue(false);
    vi.spyOn(audioEngine, 'noteOff').mockReturnValue(undefined);
    await mountShell();

    send(NOTE_ON, 30, 100);
    send(NOTE_ON, 30, 0); // released before the roots arrived
    noteOn.mockReturnValue(true);
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(noteOn).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all while the setting is off', async () => {
    useSettingsStore.setState({ midiInput: false });
    const noteOn = vi.spyOn(audioEngine, 'noteOn').mockReturnValue(true);
    render(<Harness />);

    send(NOTE_ON, 60, 100);

    expect(noteOn).not.toHaveBeenCalled();
  });
});
